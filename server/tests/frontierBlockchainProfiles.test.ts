const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getClientBlockchainProtocol,
  getClientBuildProfile,
  listClientBuildProfiles,
} = require("../src/config/clientBuildProfiles");

test("blockchain protocol follows exact packaged wallets rather than release folders", () => {
  const evmBuilds = [2455427, 2615573, 2702949, 2703993, 2726651, 2730628, 2742057,
    2763641, 2814770, 2884873, 2898485, 2973163, 2997426, 3122254];
  const suiBuilds = [3366068, 3388875, 3551616, 3572727, 3640684];
  assert.equal(evmBuilds.length + suiBuilds.length, listClientBuildProfiles().length);
  for (const build of evmBuilds) assert.equal(getClientBlockchainProtocol(build), "evm");
  for (const build of suiBuilds) assert.equal(getClientBlockchainProtocol(build), "sui");
  assert.equal(getClientBlockchainProtocol("frontier-3388875"), "sui");
  assert.equal(getClientBlockchainProtocol("2973163"), "evm");
});

test("uncatalogued and non-Frontier builds never inherit a wallet protocol", () => {
  for (const build of [0, -1, 3122253, 3122255, 3502403, 3640685, 3122254.5,
    undefined, null, NaN, Infinity, "frontier-missing"]) {
    assert.equal(getClientBlockchainProtocol(build), "unknown", String(build));
  }
  assert.equal(getClientBlockchainProtocol({ clientBuild: 2973163,
    clientCompatibilityProfile: "tranquility" }), "unknown");
  assert.equal(getClientBlockchainProtocol({ clientBuild: 2973163 }), "unknown");
});

test("blockchain selection uses the resolved explicit profile", () => {
  assert.equal(getClientBlockchainProtocol({ clientBuildProfile: "frontier-2973163",
    clientCompatibilityProfile: "tranquility", clientBuild: 3640684 }), "evm");
  assert.equal(getClientBlockchainProtocol({ clientBuildProfile: "auto",
    clientCompatibilityProfile: "frontier", clientBuild: 3640684 }), "sui");
  assert.throws(() => getClientBlockchainProtocol({ clientBuildProfile: "frontier-missing" }),
    /Unknown client build profile/);
});

test("wallet observations retain legacy signing distinctions and immutable archive evidence", () => {
  assert.equal(getClientBuildProfile("frontier-2455427").blockchain.signing, "blockchain-proxy");
  assert.equal(getClientBuildProfile("frontier-2615573").blockchain.signing, "erc2771");
  for (const profile of listClientBuildProfiles()) {
    const chain = profile.blockchain;
    assert.ok(Object.isFrozen(chain));
    assert.ok(Object.isFrozen(chain.evidence));
    assert.ok(chain.qualification);
    assert.ok(chain.evidence.length >= 2);
    assert.ok(chain.evidence.every(member => /\.py[cj]$/.test(member)));
    assert.throws(() => chain.evidence.push("invented.pyc"), TypeError);
    if (chain.protocol === "sui") {
      assert.equal(chain.signing, "sui");
      assert.ok(chain.evidence.includes("frontier/web3/client/sui_wallet_service.pyc"));
    }
  }
});
