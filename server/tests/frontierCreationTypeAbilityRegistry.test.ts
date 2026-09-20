import assert = require("node:assert/strict");
import test = require("node:test");

const abilityRuntime = require("../src/services/frontier/creationAbilityRuntime");

test("Creation abilities can be registered and resolved for one module type", () => {
  abilityRuntime.resetCreationAbilityHandlersForTests();

  const passiveTypeID = 95318;
  const activeTypeID = 95319;
  const handler = { execute: () => ({ success: true }) };

  abilityRuntime.registerCreationTypeAbilityHandler(
    activeTypeID,
    abilityRuntime.ABILITY_ACTIVATE_EFFECT,
    handler,
  );

  assert.deepEqual(
    abilityRuntime.getRegisteredTypeAbilities(passiveTypeID),
    [],
  );
  assert.deepEqual(
    abilityRuntime.getRegisteredTypeAbilities(activeTypeID),
    [abilityRuntime.ABILITY_ACTIVATE_EFFECT],
  );
  assert.equal(
    abilityRuntime.resolveCreationAbilityHandler(
      "generic",
      abilityRuntime.ABILITY_ACTIVATE_EFFECT,
      activeTypeID,
    ),
    handler,
  );
  assert.equal(
    abilityRuntime.resolveCreationAbilityHandler(
      "generic",
      abilityRuntime.ABILITY_ACTIVATE_EFFECT,
      passiveTypeID,
    ),
    null,
  );

  abilityRuntime.resetCreationAbilityHandlersForTests();
});

test("type-specific handlers take precedence over behavior handlers", () => {
  abilityRuntime.resetCreationAbilityHandlersForTests();

  const behaviorHandler = { execute: () => ({ success: true, data: "behavior" }) };
  const typeHandler = { execute: () => ({ success: true, data: "type" }) };
  abilityRuntime.registerCreationAbilityHandler(
    "generic",
    abilityRuntime.ABILITY_ACTIVATE_EFFECT,
    behaviorHandler,
  );
  abilityRuntime.registerCreationTypeAbilityHandler(
    95319,
    abilityRuntime.ABILITY_ACTIVATE_EFFECT,
    typeHandler,
  );

  assert.equal(
    abilityRuntime.resolveCreationAbilityHandler(
      "generic",
      abilityRuntime.ABILITY_ACTIVATE_EFFECT,
      95319,
    ),
    typeHandler,
  );
  assert.equal(
    abilityRuntime.resolveCreationAbilityHandler(
      "generic",
      abilityRuntime.ABILITY_ACTIVATE_EFFECT,
      95318,
    ),
    behaviorHandler,
  );

  abilityRuntime.resetCreationAbilityHandlersForTests();
});

test("ability dispatch resolves asynchronous validation and execution", async () => {
  abilityRuntime.resetCreationAbilityHandlersForTests();

  const typeID = 95319;
  const ability = abilityRuntime.ABILITY_ACTIVATE_EFFECT;
  abilityRuntime.registerCreationTypeAbilityHandler(typeID, ability, {
    async validate() {
      await Promise.resolve();
      return { success: true };
    },
    async execute() {
      await Promise.resolve();
      return { success: true, data: { completed: true } };
    },
  });

  const result = await abilityRuntime.dispatchCreationAbility({
    ability,
    kwargs: {},
    session: null,
    creationContext: {
      item: { itemID: 1001 },
      state: {
        modules: [{
          itemID: 2001,
          typeID,
          abilities: [ability],
        }],
      },
      characterID: 3001,
    },
    moduleItemID: 2001,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, { completed: true });
  abilityRuntime.resetCreationAbilityHandlersForTests();
});
