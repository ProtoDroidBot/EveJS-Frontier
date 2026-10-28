const assert = require("node:assert/strict");
const test = require("node:test");
const EncryptionWalletService = require("../src/services/frontier/encryptionWalletService");

function unmarshal(value) {
  if (value?.type === "dict") return Object.fromEntries(value.entries.map(([key, entry]) => [key, unmarshal(entry)]));
  if (value?.type === "list") return value.items.map(unmarshal);
  return value;
}

function configuration() {
  return {
    web3Config: {
      cfg: [{ name: "ERC2771Forwarder", chain_id: 31337, deployed_to: "0x1234", abi: [],
        urls: { public: ["http://127.0.0.1:3000/legacy-evm"] } }],
      systems: [{ abi: ["function bringOnline(uint256 smartObjectId)"], systemId: "0x12" }],
      system_ids: { transfer: "0x12", SmartStorageUnitSystem: "0x12" },
      transfer: { enabled: false },
      vault_dapp_url: "https://localhost/vault",
      base_dapp_url: "https://localhost/",
      exchange_wallet_address: "0x" + "ab".repeat(20),
      EVE_to_LUX_exchange_rate: 100,
    },
    tenant: "dev",
    worldApiBaseUrl: "http://127.0.0.1:3000/legacy-evm",
    walletPassphrase: "local-wallet-passphrase",
  };
}

function isWrappedFailure(error) {
  assert.equal(error?.name, "MachoWrappedException");
  const payload = error.machoErrorResponse.payload;
  assert.equal(payload.header[0].value, "eveexceptions.UserError");
  assert.equal(payload.header[1][0], "CustomNotify");
  assert.equal(typeof Object.fromEntries(payload.header[1][1].entries).notify, "string");
  return true;
}

test("legacy wallet RPCs preserve raw native configuration and nested Python containers", () => {
  const session = { userid: 7, characterID: 42 };
  const raw = configuration(), calls = [];
  const service = new EncryptionWalletService({ bridge: {
    getClientConfiguration(candidate) { calls.push(candidate); return raw; },
  } });
  assert.equal(service.name, "encryptionWalletService");
  const encoded = service.Handle_get_web3_config([], session);
  assert.equal(encoded.type, "dict");
  assert.equal(Object.fromEntries(encoded.entries).systems.type, "list");
  assert.deepEqual(unmarshal(encoded), raw.web3Config);
  assert.equal(service.Handle_get_chain_tenant([], session), raw.tenant);
  assert.equal(service.Handle_get_world_api_base_url([], session), raw.worldApiBaseUrl);
  assert.equal(service.Handle_get_wallet_passphrase([42], session), raw.walletPassphrase);
  assert.deepEqual(calls, [session, session, session, session]);
  assert.deepEqual(raw.web3Config.cfg[0].urls.public, ["http://127.0.0.1:3000/legacy-evm"]);
  assert.equal(raw.web3Config.systems[0].abi[0], "function bringOnline(uint256 smartObjectId)");
});

test("wallet passphrase cannot be requested for another character", () => {
  let calls = 0;
  const service = new EncryptionWalletService({ bridge: {
    getClientConfiguration() { calls++; return configuration(); },
  } });
  for (const requested of [undefined, 0, -1, 43, 42.5, "garbage"]) {
    assert.throws(() => service.Handle_get_wallet_passphrase([requested], { charid: 42 }), isWrappedFailure);
  }
  assert.throws(() => service.Handle_get_wallet_passphrase([42], {}), isWrappedFailure);
  assert.equal(calls, 0);
  assert.equal(service.Handle_get_wallet_passphrase([42], { charid: 42 }), "local-wallet-passphrase");
});

test("bridge authorization errors are explicit and do not expose configuration secrets", () => {
  const service = new EncryptionWalletService({ bridge: {
    getClientConfiguration() {
      throw Object.assign(new Error("private-admin-key=never-show-this"), { code: "AUTHENTICATION_REQUIRED" });
    },
  } });
  for (const method of ["get_web3_config", "get_chain_tenant", "get_world_api_base_url", "get_wallet_passphrase"]) {
    assert.throws(() => service[`Handle_${method}`]([42], { characterID: 42 }), error => {
      isWrappedFailure(error);
      const serialized = JSON.stringify(error.machoErrorResponse);
      assert.match(serialized, /authenticated session/);
      assert.doesNotMatch(serialized, /private-admin-key|never-show-this/);
      return true;
    });
  }
});

test("missing bridge configuration fails rather than returning an empty successful value", () => {
  for (const result of [null, {}, { web3Config: [], tenant: "", worldApiBaseUrl: null, walletPassphrase: "" }]) {
    const service = new EncryptionWalletService({ bridge: { getClientConfiguration: () => result } });
    for (const method of ["get_web3_config", "get_chain_tenant", "get_world_api_base_url", "get_wallet_passphrase"]) {
      assert.throws(() => service[`Handle_${method}`]([42], { characterID: 42 }), isWrappedFailure);
    }
  }
});
