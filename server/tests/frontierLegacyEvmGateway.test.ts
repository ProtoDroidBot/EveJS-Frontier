const assert = require("node:assert/strict");
const test = require("node:test");
const { buildLegacyEvmProtoRoot, createLegacyEvmGatewayService } = require("../src/_secondary/express/gatewayServices/legacyEvmGatewayService");
const REQUEST = "eve_public.blockchain.metatransaction.MetaTransactionRequest";
const RESPONSE = REQUEST.replace(/Request$/, "Response");
const root = buildLegacyEvmProtoRoot();
function envelope(data) { return { payload: { value: root.lookupType(REQUEST).encode(root.lookupType(REQUEST).fromObject(data)).finish() } }; }

test("legacy gateway translates its audited ERC2771 wire contract preserving uint64 values", async () => {
  const session = { userid: 7, characterID: 42 };
  const calls = [];
  const service = createLegacyEvmGatewayService({ clientBuild: 2973163,
    resolveGatewayIdentity: () => ({ userID: 7, characterID: 42, session }),
    legacyEvmSuiBridge: { relay: async (request, caller) => {
      calls.push({ request, caller }); return { success: true, pending: true };
    } },
  });
  const result = await service.handleRequest(REQUEST, envelope({ erc2771: {
    sender: "owner", address: "world", value: "0", gas: "18446744073709551615", nonce: "nonce",
    deadline: "281474976710655", data: "call", signature: "signature",
  } }));
  assert.equal(result.statusCode, 200);
  assert.equal(root.lookupType(RESPONSE).decode(result.responsePayloadBuffer).success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].caller, session);
  assert.equal(calls[0].request.gas.toString(), "18446744073709551615");
  assert.equal(calls[0].request.deadline.toString(), "281474976710655");
});

test("untrusted gateway claims, malformed envelopes and Sui builds cannot call the EVM relay", async () => {
  let calls = 0;
  const base = { clientBuild: 2973163, legacyEvmSuiBridge: { relay: () => { calls++; } } };
  const request = envelope({ erc2771: { sender: "forged" } });
  for (const trusted of [null, { userID: 7, characterID: 42 },
    { userID: 7, characterID: 42, session: { userid: 8, characterID: 42 } },
    { userID: 7, characterID: 42, session: { userid: 7, characterID: 43 } }]) {
    const service = createLegacyEvmGatewayService({ ...base, resolveGatewayIdentity: () => trusted });
    assert.equal((await service.handleRequest(REQUEST, request)).statusCode, 403);
  }
  const trusted = { userID: 7, characterID: 42, session: { userid: 7, characterID: 42 } };
  const service = createLegacyEvmGatewayService({ ...base, resolveGatewayIdentity: () => trusted });
  assert.equal((await service.handleRequest(REQUEST, envelope({}))).statusCode, 400);
  assert.equal((await service.handleRequest(REQUEST, { payload: { value: Buffer.from([0x0a, 0xff]) } })).statusCode, 400);
  const sui = createLegacyEvmGatewayService({ ...base, clientBuild: 3640684, resolveGatewayIdentity: () => trusted });
  assert.equal((await sui.handleRequest(REQUEST, request)).statusCode, 400);
  assert.equal(calls, 0);
  assert.equal(service.handleRequest("unrelated.Request", request), null);
  assert.equal(service.getEmptySuccessResponseType(REQUEST), null);
});

test("relay denial returns explicit failure and never a successful empty payload", async () => {
  const service = createLegacyEvmGatewayService({ clientBuild: 2973163,
    resolveGatewayIdentity: () => ({ userID: 7, characterID: 42, session: { userid: 7, characterID: 42 } }),
    legacyEvmSuiBridge: { relay: async () => { throw Object.assign(new Error("private detail"), { code: "INVALID_LEGACY_EVM_SIGNATURE" }); } },
  });
  const result = await service.handleRequest(REQUEST, envelope({ erc2771: {} }));
  assert.equal(result.statusCode, 403);
  assert.equal(result.statusMessage, "INVALID_LEGACY_EVM_SIGNATURE");
  assert.equal(result.responsePayloadBuffer.length, 0);
});
