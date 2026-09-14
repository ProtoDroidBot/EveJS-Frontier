const assert = require("node:assert/strict");
const test = require("node:test");
const {
  publishIndustryBlueprintChanged,
  publishIndustryItemsChanged,
  _testing: { getIndustryNoticeTypes },
} = require("../src/services/frontier/industryNotifications");

test("blueprint changes invalidate every owner transport and both gateway item snapshots", () => {
  const events = [];
  const notices = [];
  const session = { characterID: 140000001, sendNotification: (...args) => events.push(["current", ...args]) };
  const other = { charid: 140000001, sendNotification: (...args) => events.push(["other", ...args]) };
  const stranger = { characterID: 140000002, sendNotification: () => assert.fail("another owner's recipe") };
  assert.equal(publishIndustryBlueprintChanged(session, 998840000138, {
    sessionRegistry: { getSessions: () => [session, other, stranger] },
    publishGatewayNotice: (...args) => notices.push(args),
  }), true);
  assert.deepEqual(events, [
    ["current", "OnFrontierIndustryBlueprintChanged", "clientID", [998840000138]],
    ["other", "OnFrontierIndustryBlueprintChanged", "clientID", [998840000138]],
  ]);
  assert.equal(notices.length, 2);
  for (const [index, side] of ["inputs", "outputs"].entries()) {
    const type = getIndustryNoticeTypes()[side];
    assert.equal(notices[index][0], `eve_public.industry.api.${type.name}`);
    assert.deepEqual(notices[index][2], { character: session.characterID });
    assert.deepEqual(type.toObject(type.decode(notices[index][1]), { longs: Number, defaults: true }),
      { facility: { sequential: 998840000138 }, items: [] });
  }
});

test("blueprint notification failure preserves a committed selection and continues other deliveries", () => {
  const calls = [];
  const failing = { charid: 1, sendNotification: () => { throw new Error("closed transport"); } };
  const healthy = { characterID: 1, sendNotification: (...args) => calls.push(args) };
  const options = { sessionRegistry: { getSessions: () => [failing, healthy] },
    publishGatewayNotice: () => { throw new Error("closed gateway"); } };
  assert.equal(publishIndustryBlueprintChanged(failing, 123, options), true);
  assert.deepEqual(calls, [["OnFrontierIndustryBlueprintChanged", "clientID", [123]]]);
  assert.equal(publishIndustryBlueprintChanged({}, 123, options), false);
  assert.equal(publishIndustryBlueprintChanged(failing, 0, options), false);
  assert.equal(publishIndustryBlueprintChanged(failing, 1.5, options), false);
  assert.equal(calls.length, 1);
});

test("industry input notices use the client wire contract and full type totals", () => {
  const calls = [];
  assert.equal(publishIndustryItemsChanged(
    { characterID: 140000001 },
    5000000000,
    "inputs",
    { 34: 4294967297, 35: 9, 36: 0 },
    { publishGatewayNotice: (...args) => calls.push(args) },
  ), true);
  assert.equal(calls.length, 1);
  const [name, bytes, target] = calls[0];
  assert.equal(name, "eve_public.industry.api.InputItemsChangeNotice");
  assert.deepEqual(target, { character: 140000001 });
  // Independent wire fixture: facility field 1, repeated stacks field 2;
  // stack type field 1 and quantity field 2 preserve values above uint32.
  assert.equal(bytes.toString("hex"), "0a060880e497d012120a0a02082210818080801012060a0208231009");
});

test("withdrawing the last output publishes an empty replacement snapshot", () => {
  const calls = [];
  assert.equal(publishIndustryItemsChanged(
    { charid: 140000001 }, 123, "outputs", {},
    { publishGatewayNotice: (...args) => calls.push(args) },
  ), true);
  assert.equal(calls[0][0], "eve_public.industry.api.OutputItemsChangeNotice");
  const type = getIndustryNoticeTypes().outputs;
  const payload = type.toObject(type.decode(calls[0][1]), { longs: Number, defaults: true });
  assert.deepEqual(payload, { facility: { sequential: 123 }, items: [] });
});

test("invalid industry snapshots are not published and failed delivery does not throw", () => {
  const calls = [];
  const options = { publishGatewayNotice: (...args) => calls.push(args) };
  assert.equal(publishIndustryItemsChanged({}, 123, "inputs", {}, options), false);
  assert.equal(publishIndustryItemsChanged({ charid: 1 }, 123, "other", {}, options), false);
  assert.equal(publishIndustryItemsChanged({ charid: 1 }, 123, "inputs", { 34: -1 }, options), false);
  assert.equal(calls.length, 0);
  assert.equal(publishIndustryItemsChanged(
    { charid: 1 }, 123, "inputs", { 34: 1 },
    { publishGatewayNotice: () => { throw new Error("notice stream unavailable"); } },
  ), false);
});
