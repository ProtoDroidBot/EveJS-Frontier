const assert = require("node:assert/strict");
const test = require("node:test");
const {
  publishIndustryItemsChanged,
  _testing: { getIndustryNoticeTypes },
} = require("../src/services/frontier/industryNotifications");

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
