"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  marshalEncode,
} = require("../src/network/tcp/utils/marshal");
const ExperienceService = require(
  "../src/services/frontier/experienceService",
);
const ShellManagerService = require(
  "../src/services/frontier/shellManagerService",
);
const itemStore = require("../src/services/inventory/itemStore");
const shellEquipment = require(
  "../src/services/frontier/shellEquipmentRuntime",
);

const CHARACTER_ID = 140000005;
const FRONTIER_MARSHAL_OPTIONS = Object.freeze({
  compatibilityProfile: "frontier",
});

test("Frontier experience returns the complete zero-valued character contract", () => {
  const service = new ExperienceService();
  const response = service.Handle_get_character([], {
    characterID: CHARACTER_ID,
  });

  assert.deepEqual(response, {
    type: "dict",
    entries: [
      ["total_xp", 0],
      ["cap", 0],
      [
        "category_xp",
        {
          type: "dict",
          entries: [
            ["1", 0],
            ["2", 0],
            ["3", 0],
            ["4", 0],
          ],
        },
      ],
    ],
  });
  assert.doesNotThrow(() => marshalEncode(response, FRONTIER_MARSHAL_OPTIONS));

  assert.deepEqual(
    service.Handle_get_character([], { charid: CHARACTER_ID }),
    response,
  );
  assert.deepEqual(service.Handle_get_character([], {}), response);
});

test("Frontier experience progression exposes four attribute-bearing pathway rows", () => {
  const service = new ExperienceService();
  const response = service.Handle_get_character_progression([], {
    charid: CHARACTER_ID,
  });

  assert.equal(response.type, "list");
  assert.equal(response.items.length, 4);
  assert.deepEqual(
    response.items.map((row) => {
      assert.equal(row.type, "object");
      assert.equal(row.name, "util.KeyVal");
      return Object.fromEntries(row.args.entries);
    }),
    [
      { categoryID: 1, points: 0 },
      { categoryID: 2, points: 0 },
      { categoryID: 3, points: 0 },
      { categoryID: 4, points: 0 },
    ],
  );
  assert.doesNotThrow(() => marshalEncode(response, FRONTIER_MARSHAL_OPTIONS));

  assert.deepEqual(
    service.Handle_get_character_progression([], {}),
    response,
  );
});

test("Frontier experience keeps the existing empty-memory startup contract", () => {
  const service = new ExperienceService();
  const expected: Record<string, any> = {
    type: "dict",
    entries: [
      ["shell_memories", { type: "dict", entries: [] }],
      ["crown_memories", { type: "dict", entries: [] }],
    ],
  };

  assert.deepEqual(service.Handle_get_memories_from_character(), expected);
  assert.deepEqual(service.Handle_get_memories_from_shell(), expected);
});

function isWrappedUserError(error) {
  return Boolean(
    error &&
    error.machoErrorResponse &&
    error.machoErrorResponse.payload &&
    error.machoErrorResponse.payload.header &&
    error.machoErrorResponse.payload.header[0] &&
    error.machoErrorResponse.payload.header[0].value === "eveexceptions.UserError"
  );
}

test("Frontier experience exposes bounded empty crown, totals, and ascension reads", () => {
  const service = new ExperienceService();
  const emptyMemories = service.Handle_get_memories_from_shell();

  assert.deepEqual(
    service.Handle_get_memories_from_crown([12345], { charid: CHARACTER_ID }),
    emptyMemories,
  );
  assert.deepEqual(service.Handle_get_memory_point_totals(), {
    type: "dict",
    entries: [[1, 0], [2, 0], [3, 0], [4, 0]],
  });
  assert.deepEqual(service.Handle_get_ascension_choices(), {
    type: "list",
    items: [],
  });
  assert.doesNotThrow(() => marshalEncode(
    service.Handle_get_memory_point_totals(),
    FRONTIER_MARSHAL_OPTIONS,
  ));
});

test("semantically undefined experience mutations fail explicitly as UserError", () => {
  const service = new ExperienceService();
  const mutationMethods: any[] = [
    "delete_memory",
    "ascend",
    "implant_crown",
    "delete_active_crown",
  ];

  for (const method of mutationMethods) {
    assert.equal(typeof service[`Handle_${method}`], "function", method);
    assert.throws(
      () => service[`Handle_${method}`]([], { charid: CHARACTER_ID }),
      isWrappedUserError,
      method,
    );
  }
});

test("shell rename is owner-scoped, client-bounded, persisted, and notified", () => {
  const grant = itemStore.grantItemToOwnerLocation(
    CHARACTER_ID,
    CHARACTER_ID,
    itemStore.ITEM_FLAGS.HANGAR,
    ShellManagerService._testing.DEFAULT_SHELL_TYPE_ID,
    1,
    {
      individualItems: true,
      itemName: "Rename Test Shell",
      singleton: 1,
    },
  );
  assert.equal(grant.success, true);
  const shell = grant.data.items[0];
  const notifications: any[] = [];
  const session: Record<string, any> = {
    charid: CHARACTER_ID,
    characterID: CHARACTER_ID,
    sendNotification(...args) {
      notifications.push(args);
    },
  };

  try {
    const service = new ShellManagerService();
    assert.equal(
      service.Handle_set_shell_name([shell.itemID, "Pathfinder Shell"], session),
      true,
    );
    assert.equal(itemStore.findItemById(shell.itemID).itemName, "Pathfinder Shell");
    assert.equal(
      notifications.some((entry) =>
        entry[0] === "OnShellChangedName" &&
        entry[2][0] === shell.itemID &&
        entry[2][1] === "Pathfinder Shell"),
      true,
    );

    assert.throws(
      () => service.Handle_set_shell_name(
        [shell.itemID, "x".repeat(101)],
        session,
      ),
      isWrappedUserError,
    );
    assert.throws(
      () => service.Handle_set_shell_name(
        [shell.itemID, "Foreign Rename"],
        { charid: CHARACTER_ID + 1 },
      ),
      isWrappedUserError,
    );
    assert.equal(itemStore.findItemById(shell.itemID).itemName, "Pathfinder Shell");
  } finally {
    itemStore.removeInventoryItem(shell.itemID, { removeContents: false });
  }
});

test("undefined shell progression mutations fail explicitly as UserError", () => {
  const service = new ShellManagerService();
  const mutationMethods: any[] = [
    "create_crown",
    "implant_crown",
    "delete_active_crown",
    "admin_create_and_implant_implant",
    "admin_create_crown_without_cooldown",
    "clear_medical_trait_implants",
    "admin_grant_medical_trait_implant",
    "use_medical_kit",
    "use_status_effect_remedy",
    "admin_add_reignment_to_inventory",
    "admin_add_medical_kit_to_inventory",
    "create_and_activate_shell",
    "activate_shell",
  ];

  for (const method of mutationMethods) {
    assert.equal(typeof service[`Handle_${method}`], "function", method);
    assert.throws(
      () => service[`Handle_${method}`]([], { charid: CHARACTER_ID }),
      isWrappedUserError,
      method,
    );
  }
});

test("shell implants and raiments persist per shell and are destroyed by lifecycle cleanup", () => {
  const IMPLANT_TYPE_ID = 990001;
  const SECOND_IMPLANT_TYPE_ID = 990002;
  const RAIMENT_TYPE_ID = 990003;
  const CROWN_TYPE_ID = 990004;
  shellEquipment._testing.setEquipmentGroupOverride(
    IMPLANT_TYPE_ID,
    shellEquipment.SHELL_NEURAL_IMPLANT_GROUP_ID,
  );
  shellEquipment._testing.setEquipmentGroupOverride(
    SECOND_IMPLANT_TYPE_ID,
    shellEquipment.SHELL_NEURAL_IMPLANT_GROUP_ID,
  );
  shellEquipment._testing.setEquipmentGroupOverride(
    RAIMENT_TYPE_ID,
    shellEquipment.SHELL_RAIMENT_GROUP_ID,
  );
  shellEquipment._testing.setEquipmentGroupOverride(
    CROWN_TYPE_ID,
    shellEquipment.SHELL_CROWN_GROUP_ID,
  );

  const createdItems: any[] = [];
  const grantOwned = (typeID, itemName) => {
    const grant = itemStore.grantItemToOwnerLocation(
      CHARACTER_ID,
      CHARACTER_ID,
      itemStore.ITEM_FLAGS.HANGAR,
      typeID,
      1,
      { individualItems: true, itemName, singleton: 1 },
    );
    assert.equal(grant.success, true, grant.errorMsg);
    const item = grant.data.items[0];
    createdItems.push(item);
    return item;
  };

  const shell = grantOwned(
    ShellManagerService._testing.DEFAULT_SHELL_TYPE_ID,
    "Equipment Test Shell",
  );
  const implant = grantOwned(IMPLANT_TYPE_ID, "Test Neural Implant");
  const secondImplant = grantOwned(SECOND_IMPLANT_TYPE_ID, "Second Neural Implant");
  const raiment = grantOwned(RAIMENT_TYPE_ID, "Test Raiment");
  const crown = grantOwned(CROWN_TYPE_ID, "Deferred Crown");
  const session: Record<string, any> = {
    charid: CHARACTER_ID,
    characterID: CHARACTER_ID,
    sendNotification() {},
  };

  try {
    const shellService = new ShellManagerService();
    const experienceService = new ExperienceService();

    assert.equal(
      shellService.Handle_implant_implant([implant.itemID], session),
      true,
    );
    assert.equal(
      experienceService.Handle_implant_raiment([raiment.itemID], session),
      true,
    );
    assert.equal(shellService.Handle_has_raiment([], session), true);

    assert.equal(itemStore.findItemById(implant.itemID).locationID, shell.itemID);
    assert.equal(
      itemStore.findItemById(implant.itemID).flagID,
      shellEquipment.SHELL_EQUIPMENT_FLAG_ID,
    );
    assert.equal(itemStore.findItemById(raiment.itemID).locationID, shell.itemID);
    assert.deepEqual(shellEquipment.buildActiveShellDogmaRecord(CHARACTER_ID).implants, [
      {
        itemID: implant.itemID,
        typeID: IMPLANT_TYPE_ID,
        slot: 0,
        shellEquipmentKind: shellEquipment.SHELL_EQUIPMENT_KIND.IMPLANT,
      },
      {
        itemID: raiment.itemID,
        typeID: RAIMENT_TYPE_ID,
        slot: 0,
        shellEquipmentKind: shellEquipment.SHELL_EQUIPMENT_KIND.RAIMENT,
      },
    ]);
    assert.deepEqual(
      Object.fromEntries(
        shellService.Handle_get_active_shell_db_data([], session).entries,
      ).implants,
      { type: "list", items: [IMPLANT_TYPE_ID] },
    );
    assert.throws(
      () => shellService.Handle_implant_implant([secondImplant.itemID], session),
      isWrappedUserError,
    );

    // Removal is intentionally destructive; it never moves the item to a hangar.
    assert.equal(shellService.Handle_delete_active_implant([], session), true);
    assert.equal(itemStore.findItemById(implant.itemID), null);
    assert.equal(
      shellService.Handle_implant_implant([secondImplant.itemID], session),
      true,
    );

    // A crown can coexist in the same inventory flag, but is excluded until
    // its separate attribute semantics are implemented.
    assert.equal(
      itemStore.moveItemToLocation(
        crown.itemID,
        shell.itemID,
        shellEquipment.SHELL_EQUIPMENT_FLAG_ID,
        1,
      ).success,
      true,
    );
    const ascensionCleanup =
      shellEquipment.destroyActiveShellEquipmentForAscension(CHARACTER_ID);
    assert.equal(ascensionCleanup.success, true);
    assert.equal(ascensionCleanup.data.reason, "ascension");
    assert.equal(itemStore.findItemById(secondImplant.itemID), null);
    assert.equal(itemStore.findItemById(raiment.itemID), null);
    assert.notEqual(itemStore.findItemById(crown.itemID), null);

    const deathImplant = grantOwned(IMPLANT_TYPE_ID, "Death Test Implant");
    const deathRaiment = grantOwned(RAIMENT_TYPE_ID, "Death Test Raiment");
    assert.equal(
      shellService.Handle_implant_implant([deathImplant.itemID], session),
      true,
    );
    assert.equal(
      experienceService.Handle_implant_raiment([deathRaiment.itemID], session),
      true,
    );
    const shipDestruction = require("../src/space/shipDestruction");
    const deathCleanup =
      shipDestruction._testing.destroySessionShellEquipmentForDeath(session);
    assert.equal(deathCleanup.success, true);
    assert.equal(deathCleanup.data.reason, "death");
    assert.equal(itemStore.findItemById(deathImplant.itemID), null);
    assert.equal(itemStore.findItemById(deathRaiment.itemID), null);
    assert.notEqual(itemStore.findItemById(crown.itemID), null);
  } finally {
    shellEquipment._testing.clearEquipmentGroupOverrides();
    for (const item of createdItems.reverse()) {
      if (itemStore.findItemById(item.itemID)) {
        itemStore.removeInventoryItem(item.itemID, { removeContents: true });
      }
    }
  }
});
