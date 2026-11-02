import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { solarSystemRecord } = createRequire(import.meta.url)("../../DatabaseCreator/database-creator.js");

test("authored empty systems retain restrictions without acquiring a synthetic sun", () => {
  const source = { _key: 32000001, name: { en: "Source empty system" }, sourceHasStar: false,
    starID: 0, sunTypeID: 0, starTemperature: 0, regionID: 1, constellationID: 2,
    position: { x: 1, y: 2, z: 3 }, visualEffect: "source-effect",
    disallowedAnchorCategories: [23, 40], disallowedAnchorGroups: [10] };
  const row = solarSystemRecord(source, new Map(), new Map(), new Map());
  assert.equal(row.sourceHasStar, false);
  assert.equal(row.sunTypeID, 0);
  assert.equal(row.starTemperature, 0);
  assert.equal(row.solarSystemName, source.name.en);
  assert.equal(row.visualEffect, source.visualEffect);
  assert.deepEqual(row.disallowedAnchorCategories, source.disallowedAnchorCategories);
  assert.deepEqual(row.disallowedAnchorGroups, source.disallowedAnchorGroups);
  assert.notEqual(row.disallowedAnchorCategories, source.disallowedAnchorCategories);
  const modern = solarSystemRecord({ _key: 1, starID: 10, starTemperature: 100 }, new Map(), new Map(), new Map([[10, { typeID: 45042 }]]));
  assert.equal(modern.sunTypeID, 45042);
  assert.equal(modern.starTemperature, 150);
  assert.equal(Object.hasOwn(modern, "sourceHasStar"), false);
});
