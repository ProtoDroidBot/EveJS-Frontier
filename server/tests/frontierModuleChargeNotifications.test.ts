"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const DogmaService = require("../src/services/dogma/dogmaService");
const spaceRuntime = require("../src/space/runtime");

const {
  notifyChargeDamageChangeToSessionForTesting,
  notifyRuntimeChargeTransitionToSessionForTesting,
} = spaceRuntime._testing;

function buildSession() {
  const notifications: any[] = [];
  return {
    notifications,
    session: {
      characterID: 90000001,
      compatibilityProfile: "frontier",
      _space: {
        simFileTime: 133700000000000000n,
      },
      sendNotification(name, idType, payload) {
        notifications.push({ name, idType, payload });
      },
    },
  };
}

function getAttributeChange(notification) {
  return notification.payload[0].items[0];
}

function getKeyValField(value, fieldName) {
  return value.args.entries.find(([key]) => key === fieldName)[1];
}

test("weapon ammo consumption updates both the live charge row and Dogma quantity", () => {
  const { session, notifications } = buildSession();

  assert.equal(
    notifyRuntimeChargeTransitionToSessionForTesting(
      session,
      1001,
      27,
      { typeID: 82128, quantity: 5 },
      { typeID: 82128, quantity: 4 },
      session.characterID,
    ),
    true,
  );

  assert.deepEqual(
    notifications.map((notification) => notification.name),
    ["OnItemChange", "OnModuleAttributeChanges"],
  );
  const itemChange = notifications[0].payload;
  assert.deepEqual(itemChange[0].fields.itemID, [1001, 27, 82128]);
  assert.equal(itemChange[0].fields.stacksize, 4);
  assert.deepEqual(itemChange[1].entries, [[9, 5]]);

  const attributeChange = getAttributeChange(notifications[1]);
  assert.deepEqual(attributeChange[2], [1001, 27, 82128]);
  assert.ok(Number(attributeChange[3]) > 0);
  assert.equal(attributeChange[5], 4);
  assert.equal(attributeChange[6], 5);
  assert.equal(attributeChange[7], attributeChange[4]);
});

test("the last weapon charge is removed from the live HUD sublocation", () => {
  const { session, notifications } = buildSession();

  notifyRuntimeChargeTransitionToSessionForTesting(
    session,
    1001,
    27,
    { typeID: 82128, quantity: 1 },
    { typeID: 82128, quantity: 0 },
    session.characterID,
  );

  assert.deepEqual(
    notifications.map((notification) => notification.name),
    ["OnItemChange", "OnModuleAttributeChanges"],
  );
  const removedCharge = notifications[0].payload;
  assert.deepEqual(removedCharge[0].fields.itemID, [1001, 27, 82128]);
  assert.equal(removedCharge[0].fields.locationID, 6);
  assert.deepEqual(removedCharge[1].entries, [[3, 1001]]);

  const attributeChange = getAttributeChange(notifications[1]);
  assert.equal(attributeChange[5], 0);
  assert.equal(attributeChange[6], 1);
});

test("reloading a partial charge stack refreshes the live HUD row", () => {
  const { session, notifications } = buildSession();
  const dogma = new DogmaService();

  assert.equal(
    dogma._notifyChargeQuantityTransition(
      session,
      session.characterID,
      1001,
      27,
      { typeID: 82128, quantity: 5 },
      { typeID: 82128, quantity: 20 },
      {},
    ),
    true,
  );

  assert.deepEqual(
    notifications.map((notification) => notification.name),
    ["OnItemChange", "OnModuleAttributeChanges"],
  );
  assert.equal(notifications[0].payload[0].fields.stacksize, 20);
  assert.deepEqual(notifications[0].payload[1].entries, [[9, 5]]);
});

test("reloading an empty module primes the Frontier tuple before restoring its HUD row", async () => {
  const { session, notifications } = buildSession();
  const dogma = new DogmaService();
  const chargeItem = {
    itemID: 2002,
    typeID: 82128,
    ownerID: session.characterID,
    locationID: 1001,
    flagID: 27,
    quantity: 20,
    stacksize: 20,
    singleton: 0,
    groupID: 4623,
    categoryID: 8,
  };

  assert.equal(
    dogma._notifyChargeQuantityTransition(
      session,
      session.characterID,
      1001,
      27,
      { typeID: 0, quantity: 0 },
      { typeID: chargeItem.typeID, quantity: 20 },
      { nextChargeItem: chargeItem },
    ),
    true,
  );

  const prime = notifications.find(
    (notification) => notification.name === "OnGodmaPrimeItem",
  );
  assert.ok(prime);
  const primeAttributes = getKeyValField(prime.payload[1], "attributes");
  const primeTime = getKeyValField(prime.payload[1], "time");
  assert.ok(primeAttributes.entries.length > 0);
  for (const [, value] of primeAttributes.entries) {
    assert.ok(Array.isArray(value));
    assert.equal(value.length, 2);
    assert.equal(value[1], primeTime);
  }

  assert.deepEqual(
    notifications.slice(0, 3).map((notification) => notification.name),
    ["OnGodmaPrimeItem", "OnItemChange", "OnModuleAttributeChanges"],
  );
  assert.equal(notifications[1].payload[0].fields.stacksize, 20);

  await new Promise((resolve) => setTimeout(resolve, 175));

  const itemChanges = notifications.filter(
    (notification) => notification.name === "OnItemChange",
  );
  assert.ok(itemChanges.length >= 1);
  assert.equal(itemChanges.at(-1).payload[0].fields.stacksize, 20);
});

test("charge durability primes the live tuple before publishing damage", async () => {
  const { session, notifications } = buildSession();
  const chargeItem = {
    itemID: 2001,
    typeID: 83463,
    ownerID: session.characterID,
    locationID: 1001,
    flagID: 27,
    quantity: 1,
    stacksize: 1,
    singleton: 1,
    groupID: 0,
    categoryID: 8,
    moduleState: { damage: 0.02 },
  };

  assert.equal(
    notifyChargeDamageChangeToSessionForTesting(
      session,
      1001,
      27,
      chargeItem.typeID,
      0.02,
      0,
      session._space.simFileTime,
      chargeItem,
    ),
    true,
  );
  assert.equal(notifications[0].name, "OnGodmaPrimeItem");
  const primeAttributes = getKeyValField(
    notifications[0].payload[1],
    "attributes",
  );
  assert.ok(primeAttributes.entries.length > 0);
  for (const [, value] of primeAttributes.entries) {
    assert.deepEqual(value.slice(1), [session._space.simFileTime]);
  }

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(
    notifications.map((notification) => notification.name),
    ["OnGodmaPrimeItem", "OnModuleAttributeChanges"],
  );
  const damageChange = getAttributeChange(notifications[1]);
  assert.deepEqual(damageChange[2], [1001, 27, 83463]);
  assert.equal(damageChange[3], 3);
  assert.equal(damageChange[5], 0.02);
  assert.equal(damageChange[6], 0);
});
