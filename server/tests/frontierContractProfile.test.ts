const assert = require("node:assert/strict");
const test = require("node:test");
const protobuf = require("protobufjs");
const { applyFrontier3640684ContractProfile, validateFrontierNoticeTarget, shouldDeliverFrontierNotice } = require("../src/_secondary/express/gatewayServices/frontierContractProfile");

test("3640684 shared descriptor preserves zigzag IDs and exact uint64 values", () => {
  const root = applyFrontier3640684ContractProfile(new protobuf.Root(), 3640684);
  root.resolveAll();
  const target = root.lookupType("eve_public.Notice.TargetGroup");
  assert.equal(Buffer.from(target.encode({ user: 42 }).finish()).toString("hex"), "1854");
  for (const value of [0, -2147483648, 2147483647]) assert.equal(target.decode(target.encode({ user: value }).finish()).user, value);
  for (const name of ["eve_public.solarsystem.Identifier", "eve_public.faction.Identifier", "eve_public.inventory.genericitemtype.Identifier", "eve_public.skilltype.Identifier"]) {
    const type = root.lookupType(name);
    for (const value of ["4294967296", "9007199254740993", "18446744073709551615"]) {
      assert.equal(type.decode(type.encode(type.fromObject({ sequential: value })).finish()).sequential.toString(), value);
    }
  }
  assert.equal(target.fields.bubble_instance_uuid, undefined);
  assert.ok(root.lookupType("eve_public.Event").fields.authoritative_context);
  assert.ok(root.lookupType("eve_public.Request").fields.trace_context);
});

test("other build roots remain unchanged", () => {
  const root = protobuf.Root.fromJSON({ nested: { Legacy: { fields: { user: { id: 3, type: "int64" } } } } });
  const previous = root.toJSON();
  assert.equal(applyFrontier3640684ContractProfile(root, 3502403), root);
  assert.deepEqual(root.toJSON(), previous);
});

test("3640684 notices require an authenticated matching bounded target", () => {
  const state = { authenticated: true, userID: 42, activeCharacterID: 123, solarSystemID: 30000001, corporationID: 98, allianceID: 99, applicationInstanceHex: "aa".repeat(16) };
  for (const target of [{ user: 42 }, { character: 123 }, { solar_system: 30000001 }, { corporation: 98 }, { alliance: 99 }, { application_instance_uuid: Buffer.alloc(16, 0xaa) }]) {
    assert.equal(validateFrontierNoticeTarget(target), true);
    assert.equal(shouldDeliverFrontierNotice(state, { target_group: target }), true);
    assert.equal(shouldDeliverFrontierNotice({ ...state, authenticated: false }, { target_group: target }), false);
  }
  for (const target of [null, {}, { user: 43 }, { character: 456 }, { user: 42, character: 123 }, { bubble_instance_uuid: Buffer.alloc(16) }, { user: 2147483648 }, { character: 4294967296 }]) {
    assert.equal(shouldDeliverFrontierNotice(state, { target_group: target }), false);
  }
  assert.equal(shouldDeliverFrontierNotice({ authenticated: true }, { target_group: { user: 42 } }), false);
});
