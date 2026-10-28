import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { addPhysicsGunAuthority } = require("../../DatabaseCreator/database-creator.js");

test("Physics Gun copies Cutting Laser data and gets a weapon hardpoint adapter", () => {
  const sourceType = { typeID: 95317, name: "Cutting Laser", groupID: 4767, capacity: 2 };
  const sourceDogma = { dogmaAttributes: [{ attributeID: 73, value: 2000 }], dogmaEffects: [{ effectID: 12887, isDefault: true }] };
  const sourceModule = { _key: 95317, typeID: 95317, behavior: "generic", capability: "weapon", placement: { compatible_hardpoints: ["weapon"] }, system: "weapons" };
  const types = [sourceType];
  const typeByID = new Map([[95317, sourceType]]);
  const dogmaByTypeID = new Map([["95317", sourceDogma]]);
  const creationModules = [sourceModule];

  addPhysicsGunAuthority(types, typeByID, dogmaByTypeID, creationModules);

  assert.equal(typeByID.get(99999).name, "Physics Gun");
  assert.equal(typeByID.get(99999).groupID, sourceType.groupID);
  assert.deepEqual(dogmaByTypeID.get("99999"), sourceDogma);
  assert.notEqual(dogmaByTypeID.get("99999"), sourceDogma);
  assert.deepEqual(creationModules[1], { ...sourceModule, _key: 99999, typeID: 99999 });
  assert.throws(() => addPhysicsGunAuthority(types, typeByID, dogmaByTypeID, creationModules), /collides/);
});
