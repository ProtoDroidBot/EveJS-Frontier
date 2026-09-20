"""Regression coverage for non-modular fitting in Frontier build 3502403."""

import hashlib
import importlib.util
import json
import marshal
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock
import zipfile


CLIENT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CLIENT_DIR))

import fitting_compatibility_adapter as adapter  # noqa: E402
import action_bar_compatibility_adapter as action_bar_adapter  # noqa: E402
import action_bar_selection_adapter as selection_adapter  # noqa: E402
import creation_service_compatibility_adapter as service_adapter  # noqa: E402
import patch_frontier_fitting as patcher  # noqa: E402
import frontier_windows_client as windows  # noqa: E402


NS = types.SimpleNamespace


def member_for(code):
    return importlib.util.MAGIC_NUMBER + bytes(12) + marshal.dumps(code)


class Window:
    opened = None

    @classmethod
    def Open(cls, *args, **kwargs):
        cls.opened = cls(*args, **kwargs)
        return cls.opened

    @classmethod
    def GetIfOpen(cls, *args, **kwargs):
        return cls.opened

    @classmethod
    def ToggleOpenClose(cls, *args, **kwargs):
        window = cls.GetIfOpen()
        if window is not None:
            window.closed = True
            cls.opened = None
            return None
        return cls.Open(*args, **kwargs)


class AdapterTests(unittest.TestCase):
    def setUp(self):
        Window.opened = None
        self.events = []
        self.ship = NS(typeID=95276)

        test = self

        class FittingWindow(Window):
            default_descriptionLabelPath = "description"

            def __init__(self, *args, **kwargs):
                self.closed = False
                test.events.append("legacy-window")

            @classmethod
            def Open(cls, *args, **kwargs):
                test.events.append("creation-window")

            @classmethod
            def ToggleOpenClose(cls, *args, **kwargs):
                test.events.append("creation-toggle")

        class EveCommandService:
            def OpenFitting(self, *args, **kwargs):
                test.events.append("creation-command")

        class CreationService:
            def __init__(self):
                self._active_creation = None

            def get_creation(self, creation_id):
                test.events.append(("creation-rpc", creation_id))
                return object()

        EveCommandService.OpenFitting.nameLabelPath = "fuel-label"
        self.FittingWindow = FittingWindow
        self.Command = EveCommandService
        self.CreationService = CreationService
        self.namespace = {
            "EveCommandService": EveCommandService,
            "FittingWindow": FittingWindow,
            "_evejs_creation_service_type": CreationService,
            "session": NS(shipid=100),
            "sm": NS(GetService=lambda name: NS(GetItem=lambda item_id: self.ship)),
        }
        adapter._evejs_install_fitting_compatibility(self.namespace)

    def test_modular_hulls_keep_the_creation_management_view(self):
        self.Command().OpenFitting()
        self.FittingWindow.Open()
        self.FittingWindow.ToggleOpenClose()
        self.CreationService().get_creation(100)
        self.assertEqual(
            self.events,
            [
                "creation-command",
                "creation-window",
                "creation-toggle",
                ("creation-rpc", 100),
            ],
        )

    def test_non_modular_hulls_open_and_toggle_the_legacy_fitting_window(self):
        self.ship.typeID = 87698
        command = self.Command()
        command.OpenFitting()
        self.assertEqual(self.events, ["legacy-window"])
        self.assertIsNotNone(self.FittingWindow.opened)
        command.OpenFitting()
        self.assertTrue(self.events[0] == "legacy-window")
        self.assertIsNone(self.FittingWindow.opened)
        self.assertNotIn("creation-command", self.events)
        self.assertNotIn("creation-window", self.events)
        self.assertNotIn("creation-toggle", self.events)

    def test_non_modular_creation_poll_is_short_circuited_locally(self):
        self.ship.typeID = 87698
        service = self.CreationService()
        self.assertIsNone(service.get_creation(100))
        self.assertIsNone(service._active_creation)
        self.assertEqual(self.events, [])
        self.assertIsNotNone(service.get_creation(101))
        self.assertEqual(self.events, [("creation-rpc", 101)])

    def test_docked_non_modular_hull_uses_client_dogma_fallback(self):
        self.ship.typeID = 87698

        def get_service(name):
            if name == "godma":
                return NS(GetItem=lambda item_id: None)
            if name == "clientDogmaIM":
                return NS(
                    GetDogmaLocation=lambda: NS(
                        GetItem=lambda item_id: self.ship
                    )
                )
            raise AssertionError(name)

        self.namespace["sm"] = NS(GetService=get_service)
        self.Command().OpenFitting()
        self.assertEqual(self.events, ["legacy-window"])

    def test_unresolved_active_ship_does_not_call_creation(self):
        def get_service(name):
            if name == "godma":
                return NS(GetItem=lambda item_id: None)
            if name == "clientDogmaIM":
                return NS(
                    GetDogmaLocation=lambda: NS(GetItem=lambda item_id: None)
                )
            raise AssertionError(name)

        self.namespace["sm"] = NS(GetService=get_service)
        # The installed wrappers retain the namespace by reference.
        self.Command().OpenFitting()
        self.assertEqual(self.events, ["legacy-window"])
        service = self.CreationService()
        self.assertIsNone(service.get_creation(100))
        self.assertNotIn(("creation-rpc", 100), self.events)

    def test_space_ball_resolves_ship_before_dogma_caches(self):
        self.ship.typeID = 87698

        def get_service(name):
            if name == "godma":
                return NS(GetItem=lambda item_id: None)
            if name == "clientDogmaIM":
                return NS(
                    GetDogmaLocation=lambda: NS(GetItem=lambda item_id: None)
                )
            if name == "michelle":
                return NS(GetBall=lambda item_id: self.ship)
            raise AssertionError(name)

        self.namespace["sm"] = NS(GetService=get_service)
        self.Command().OpenFitting()
        self.assertEqual(self.events, ["legacy-window"])

    def test_patch_is_idempotent_and_preserves_command_metadata(self):
        first = self.Command.OpenFitting
        first_creation = self.CreationService.get_creation
        adapter._evejs_install_fitting_compatibility(self.namespace)
        self.assertIs(self.Command.OpenFitting, first)
        self.assertIs(self.CreationService.get_creation, first_creation)
        self.assertEqual(self.Command.OpenFitting.nameLabelPath, "fuel-label")


class CreationServiceAdapterTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.ship = NS(typeID=87698)
        test = self

        class CreationService:
            def __init__(self):
                self._active_creation = "stale"

            def get_creation(self, creation_id):
                test.events.append(("creation-rpc", creation_id))
                return object()

            def get_active_creation(self):
                test.events.append("active-creation")
                return self.get_creation(100)

        self.CreationService = CreationService
        self.namespace = {
            "CreationService": CreationService,
            "session": NS(shipid=100),
            "sm": NS(
                GetService=lambda name: NS(
                    GetItem=lambda item_id: self.ship,
                )
            ),
        }
        service_adapter._evejs_install_creation_service_compatibility(
            self.namespace
        )

    def test_ordinary_active_ship_never_enters_creation_service(self):
        service = self.CreationService()
        self.assertIsNone(service.get_active_creation())
        self.assertIsNone(service.get_creation(100))
        self.assertIsNone(service._active_creation)
        self.assertEqual(self.events, [])

    def test_creation_hull_preserves_original_service_behavior(self):
        self.ship.typeID = 95276
        service = self.CreationService()
        self.assertIsNotNone(service.get_active_creation())
        self.assertEqual(
            self.events,
            ["active-creation", ("creation-rpc", 100)],
        )

    def test_non_active_creation_lookups_are_not_suppressed(self):
        service = self.CreationService()
        self.assertIsNotNone(service.get_creation(101))
        self.assertEqual(self.events, [("creation-rpc", 101)])

    def test_service_patch_is_idempotent(self):
        first_get = self.CreationService.get_creation
        first_active = self.CreationService.get_active_creation
        service_adapter._evejs_install_creation_service_compatibility(
            self.namespace
        )
        self.assertIs(self.CreationService.get_creation, first_get)
        self.assertIs(self.CreationService.get_active_creation, first_active)


class ActionBarAdapterTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.ship = NS(typeID=87698, modules=[])
        self.module = NS(
            itemID=500,
            typeID=600,
            locationID=100,
            flagID=27,
        )
        self.medium_module = NS(
            itemID=501,
            typeID=601,
            locationID=100,
            flagID=19,
        )
        self.low_module = NS(
            itemID=502,
            typeID=602,
            locationID=100,
            flagID=11,
        )
        self.rig = NS(
            itemID=503,
            typeID=603,
            locationID=100,
            flagID=92,
        )
        self.charge = NS(
            itemID=(100, 27, 700),
            typeID=700,
            categoryID=8,
            flagID=27,
            stacksize=12,
        )
        self.ship.modules.extend((
            self.module,
            self.medium_module,
            self.low_module,
            self.rig,
        ))
        test = self

        class AbilityId:
            ACTIVATE_EFFECT = "activate_effect"
            DEACTIVATE_EFFECT = "deactivate_effect"
            ONLINE = "online"
            OFFLINE = "offline"
            RELOAD = "reload"
            UNLOAD = "unload"

        class ModuleRef:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

        class StateManager:
            def GetSubLocation(self, location_id, flag_id):
                if (location_id, flag_id) == (100, 27):
                    return test.charge
                return None

            def GetItemsInLocation(self, location_id):
                return [test.charge] if location_id == 100 else []

            def GetDefaultEffect(self, type_id):
                return NS(effectName="useMissiles") if type_id == 600 else None

            def Activate(self, item_id, effect_name, target_id, repeat):
                test.events.append(
                    ("activate", item_id, effect_name, target_id, repeat)
                )
                return 1

            def Deactivate(self, item_id, effect_name):
                test.events.append(("deactivate", item_id, effect_name))
                return 1

        class DogmaLM:
            def LoadAmmo(self, *args):
                test.events.append(("load", args))

            def UnloadAmmo(self, *args):
                test.events.append(("unload", args))

        class Godma:
            def __init__(self):
                self.state_manager = StateManager()
                self.dogma_lm = DogmaLM()

            def GetItem(self, item_id):
                return {
                    100: test.ship,
                    500: test.module,
                    501: test.medium_module,
                    502: test.low_module,
                    503: test.rig,
                }.get(item_id)

            def GetStateManager(self):
                return self.state_manager

            def GetDogmaLM(self):
                return self.dogma_lm

        class ModuleActionProvider:
            def __init__(self):
                self._godma = Godma()

            def get_activatable_modules(self, ship_id):
                test.events.append(("creation-modules", ship_id))
                return ["creation-module"]

            def is_auto_fire_available(self, ship_id):
                test.events.append(("creation-auto-fire", ship_id))
                return True

            def _get_loaded_charge(self, module_item_id):
                test.events.append(("creation-charge", module_item_id))
                return "creation-charge"

            def _module_charge_from_item(self, item):
                return NS(
                    type_id=item.typeID,
                    item_id=item.itemID,
                    quantity=item.stacksize,
                    damage=0.0,
                )

            def has_activatable_default_effect(self, type_id):
                return type_id == 600

            def has_online_effect(self, type_id):
                return type_id in (600, 601)

            def activate(
                self,
                ship_id,
                module_item_id,
                action=AbilityId.ACTIVATE_EFFECT,
                **params,
            ):
                test.events.append(
                    ("creation-activate", ship_id, module_item_id, action, params)
                )
                return "creation-time"

            def reload(self, ship_id, module_item_id, **params):
                test.events.append(
                    ("creation-reload", ship_id, module_item_id, params)
                )
                return "creation-reload-time"

            def on_module_reloaded(self, module_item_id):
                test.events.append(("reloaded", module_item_id))

        self.AbilityId = AbilityId
        self.Provider = ModuleActionProvider
        self.namespace = {
            "ModuleActionProvider": ModuleActionProvider,
            "AbilityId": AbilityId,
            "ModuleRef": ModuleRef,
            "gametime": NS(now_sim=lambda: "now"),
            "invconst": NS(
                categoryCharge=8,
                flagLoSlot0=11,
                flagLoSlot7=18,
                flagMedSlot0=19,
                flagMedSlot7=26,
                flagHiSlot0=27,
                flagHiSlot7=34,
            ),
        }
        action_bar_adapter._evejs_install_action_bar_compatibility(
            self.namespace
        )

    def test_regular_modules_populate_action_bar_with_charge_state(self):
        modules = self.Provider().get_activatable_modules(100)
        self.assertEqual(len(modules), 3)
        self.assertEqual(modules[0].item_id, 500)
        self.assertEqual(modules[0].type_id, 600)
        self.assertEqual(modules[0].loaded_type_id, 700)
        self.assertEqual(modules[0].loaded_count, 12)
        self.assertEqual(
            modules[0].abilities,
            [
                self.AbilityId.ACTIVATE_EFFECT,
                self.AbilityId.DEACTIVATE_EFFECT,
                self.AbilityId.ONLINE,
                self.AbilityId.OFFLINE,
            ],
        )
        self.assertEqual(modules[1].item_id, 501)
        self.assertEqual(
            modules[1].abilities,
            [self.AbilityId.ONLINE, self.AbilityId.OFFLINE],
        )
        self.assertEqual(modules[2].item_id, 502)
        self.assertEqual(modules[2].abilities, [])
        self.assertNotIn(503, [module.item_id for module in modules])
        self.assertEqual(self.events, [])

    def test_regular_module_actions_use_legacy_dogma(self):
        provider = self.Provider()
        self.assertEqual(
            provider.activate(100, 500, target_id=900, repeat=1000),
            "now",
        )
        self.assertEqual(
            provider.activate(100, 500, self.AbilityId.OFFLINE),
            "now",
        )
        self.assertEqual(
            provider.reload(100, 500, type_id=700, item_id=701),
            "now",
        )
        self.assertEqual(
            provider.activate(100, 500, self.AbilityId.UNLOAD),
            "now",
        )
        self.assertEqual(
            self.events,
            [
                ("activate", 500, "useMissiles", 900, 1000),
                ("deactivate", 500, "online"),
                ("load", (100, [500], [701], 100)),
                ("reloaded", 500),
                ("unload", (100, [500], 100, None)),
                ("reloaded", 500),
            ],
        )

    def test_creation_hulls_keep_original_provider_behavior(self):
        self.ship.typeID = 95276
        provider = self.Provider()
        self.assertEqual(
            provider.get_activatable_modules(100),
            ["creation-module"],
        )
        self.assertTrue(provider.is_auto_fire_available(100))
        self.assertEqual(
            provider.activate(100, 500),
            "creation-time",
        )
        self.assertEqual(
            self.events,
            [
                ("creation-modules", 100),
                ("creation-auto-fire", 100),
                (
                    "creation-activate",
                    100,
                    500,
                    self.AbilityId.ACTIVATE_EFFECT,
                    {},
                ),
            ],
        )

    def test_action_bar_patch_is_idempotent(self):
        first = self.Provider.get_activatable_modules
        action_bar_adapter._evejs_install_action_bar_compatibility(
            self.namespace
        )
        self.assertIs(self.Provider.get_activatable_modules, first)


class ActionBarSelectionAdapterTests(unittest.TestCase):
    def setUp(self):
        self.selected = []
        test = self

        class ItemAction:
            def __init__(self, type_id):
                self.key = ("item", type_id)
                self.item_component = NS(type_id=type_id)

        class ItemActionManager:
            def has_available_action(self, item):
                return item.type_id in (700, 701)

            def get_action(self, type_id):
                return ItemAction(type_id)

        class Inventory:
            def List(self, flag_id):
                self.flag_id = flag_id
                return [
                    NS(typeID=700),
                    NS(typeID=700),
                    NS(typeID=701),
                    NS(typeID=702),
                ]

        class ActionBarIntegration:
            def __init__(self, ship_id):
                self._loaded_ship_id = ship_id
                self._item_action_manager = ItemActionManager()
                self._inventory_cache_service = NS(
                    GetInventoryFromId=lambda item_id: Inventory()
                )
                self._slots = [
                    NS(action=ItemAction(700)),
                    NS(action=None),
                ]

            def _add_available_module_entries(self, menu, slot_index):
                menu.AddCaption("Add module")

            def _set_slot_action(self, slot_index, action):
                test.selected.append((self._loaded_ship_id, slot_index, action.key))

        self.Integration = ActionBarIntegration
        self.namespace = {
            "ActionBarIntegration": ActionBarIntegration,
            "evetypes": NS(
                GetName=lambda type_id: {700: "Booster", 701: "Nanite"}[type_id],
                GetIconID=lambda type_id: type_id + 1000,
            ),
            "GetIconFile": lambda icon_id: "icon:{}".format(icon_id),
            "_evejs_action_bar_db_row_to_item": (
                lambda row: NS(type_id=row.typeID)
            ),
            "_evejs_action_bar_flag_cargo": 5,
        }
        selection_adapter._evejs_install_action_bar_selection(self.namespace)

    @staticmethod
    def _menu():
        class Menu:
            def __init__(self):
                self.captions = []
                self.entries = []

            def AddCaption(self, text):
                self.captions.append(text)

            def AddEntry(self, **entry):
                self.entries.append(entry)

        return Menu()

    def test_consumables_are_selectable_for_regular_and_creation_ships(self):
        for ship_id in (100, 200):
            menu = self._menu()
            self.Integration(ship_id)._add_available_module_entries(menu, 1)
            self.assertEqual(menu.captions, ["Add module", "Add consumable"])
            self.assertEqual(
                [(entry["text"], entry["texturePath"]) for entry in menu.entries],
                [("Nanite", "icon:1701")],
            )
            menu.entries[0]["func"]()

        self.assertEqual(
            self.selected,
            [
                (100, 1, ("item", 701)),
                (200, 1, ("item", 701)),
            ],
        )

    def test_action_bar_selection_patch_is_idempotent(self):
        first = self.Integration._add_available_module_entries
        selection_adapter._evejs_install_action_bar_selection(self.namespace)
        self.assertIs(self.Integration._add_available_module_entries, first)


class WindowsUpgradeTests(unittest.TestCase):
    def test_upgrade_installs_fitting_patch_and_records_transaction_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            code = stage / "code.ccp"
            manifest = stage / "manifest.dat"
            marker_path = stage / windows.STAGE_MARKER_NAME
            code.write_bytes(b"existing verified client patches")
            manifest.write_bytes(b"original manifest")
            marker = {
                "build": 3502403,
                "nativeBlue": "blue.pyd",
                "clientPatchBackup": "retain-existing-backup",
                "currentHashes": {
                    "code.ccp": windows.sha256_file(code),
                    "manifest.dat": windows.sha256_file(manifest),
                },
            }
            marker_path.write_text(json.dumps(marker), encoding="utf-8")
            original_code = code.read_bytes()
            checks = []

            def check(*_args, **options):
                checks.append(options)
                return {"valid": True}

            def run(script, *_args, **_kwargs):
                self.assertEqual(script, windows.FITTING_COMPATIBILITY_PATCHER)
                code.write_bytes(code.read_bytes() + b" plus fitting compatibility")

            def refresh(*_args):
                manifest.write_bytes(b"refreshed manifest")

            states = {
                "docking": "patched",
                "features": "patched",
                "industryStorage": "patched",
                "mapViewLifecycle": "patched",
                "fittingCompatibility": "outdated",
                "inventoryView": "patched",
                "collisionVfx": "patched",
            }
            with (
                mock.patch.object(windows, "check_stage", side_effect=check),
                mock.patch.object(
                    windows, "load_stage", return_value=(marker_path, marker)
                ),
                mock.patch.object(
                    windows,
                    "stage_paths",
                    return_value={"code": code, "manifest": manifest},
                ),
                mock.patch.object(windows, "code_patch_states", return_value=states),
                mock.patch.object(
                    windows, "resolve_profile", return_value=(None, {})
                ),
                mock.patch.object(windows, "run_python_patcher", side_effect=run),
                mock.patch.object(
                    windows, "refresh_manifest_atomic", side_effect=refresh
                ),
            ):
                self.assertTrue(
                    windows.upgrade_industry_storage_stage(stage)["valid"]
                )

            saved = windows.read_json(marker_path)
            self.assertEqual(saved["clientPatchBackup"], "retain-existing-backup")
            self.assertEqual(saved["fittingCompatibilityPatchState"], "patched")
            backup = Path(saved["fittingCompatibilityPatchBackup"])
            self.assertEqual((backup / "code.ccp").read_bytes(), original_code)
            self.assertTrue(checks[0]["allow_fitting_compatibility_source"])
            self.assertTrue(checks[0]["allow_fitting_compatibility_outdated"])
            self.assertNotIn("allow_fitting_compatibility_source", checks[1])
            self.assertNotIn("allow_fitting_compatibility_outdated", checks[1])


@unittest.skipUnless(
    sys.version_info[:2] == (3, 12), "Native code patch requires Python 3.12"
)
class FittingBytecodePatchTests(unittest.TestCase):
    def test_fixture_patch_is_exact_idempotent_and_rejects_tampering(self):
        code = compile(
            "class FittingWindow: pass\n"
            "class EveCommandService: pass\n",
            "fixture.py",
            "exec",
        )
        source = member_for(code)
        expected = hashlib.sha256(source).hexdigest()
        patched = patcher.patched_member(source)
        self.assertEqual(patcher.inspect_member(source, expected)[0], "source")
        self.assertEqual(patcher.inspect_member(patched, expected)[0], "patched")
        with self.assertRaises(patcher.FittingPatchError):
            patcher.inspect_member(patched[:-1] + b"!", expected)
        with self.assertRaises(patcher.FittingPatchError):
            patcher.inspect_archive(Path("unused"), 3502404)

    def test_exact_previous_wrapper_is_upgradeable(self):
        code = compile(
            "class FittingWindow: pass\n"
            "class EveCommandService: pass\n",
            "fixture.py",
            "exec",
        )
        source = member_for(code)
        expected = hashlib.sha256(source).hexdigest()
        legacy_wrapper = compile(
            "import marshal as _legacy_marshal\n"
            "exec(_legacy_marshal.loads(b'EVEJS_FITTING_ORIGINAL_MEMBER_V1'[16:]))\n",
            code.co_filename,
            "exec",
            dont_inherit=True,
        )
        constants = tuple(
            source
            if value == patcher.SOURCE_SENTINEL
            else value
            for value in legacy_wrapper.co_consts
        )
        legacy_member = source[:16] + marshal.dumps(
            legacy_wrapper.replace(co_consts=constants)
        )
        with mock.patch.object(
            patcher,
            "PREVIOUS_WRAPPER_SHA256",
            {hashlib.sha256(legacy_member).hexdigest()},
        ):
            state, original = patcher.inspect_member(legacy_member, expected)
        self.assertEqual(state, "outdated")
        self.assertEqual(original, source)

    def test_action_bar_integration_wrapper_is_exact_and_idempotent(self):
        code = compile(
            "class ActionBarIntegration:\n"
            "    def _add_available_module_entries(self, menu, slot_index): pass\n",
            "integration_fixture.py",
            "exec",
        )
        source = member_for(code)
        expected = hashlib.sha256(source).hexdigest()
        patched = patcher.patched_action_bar_integration_member(source)
        self.assertEqual(
            patcher.inspect_member(
                source,
                expected,
                patcher.patched_action_bar_integration_member,
                set(),
            )[0],
            "source",
        )
        self.assertEqual(
            patcher.inspect_member(
                patched,
                expected,
                patcher.patched_action_bar_integration_member,
                set(),
            )[0],
            "patched",
        )

    def test_skillshot_wrappers_are_exact_and_idempotent(self):
        controller_code = compile(
            "class SkillShotController:\n"
            "    def fire(self): pass\n"
            "    def _fire_session(self): pass\n"
            "    @staticmethod\n"
            "    def _build_turret_states(ids, direction): return []\n",
            "skillshot_controller_fixture.py",
            "exec",
        )
        auto_cannon_code = compile(
            "class AutoCannonMode:\n"
            "    def _auto_fire_loop(self): pass\n"
            "    def OnSkillShotFailed(self, key, args): pass\n",
            "skillshot_auto_cannon_fixture.py",
            "exec",
        )
        for code, builder in (
            (controller_code, patcher.patched_skillshot_controller_member),
            (auto_cannon_code, patcher.patched_skillshot_auto_cannon_member),
        ):
            source = member_for(code)
            expected = hashlib.sha256(source).hexdigest()
            patched = builder(source)
            self.assertEqual(
                patcher.inspect_member(
                    source, expected, builder, set()
                )[0],
                "source",
            )
            self.assertEqual(
                patcher.inspect_member(
                    patched, expected, builder, set()
                )[0],
                "patched",
            )

    @unittest.skipUnless(
        os.environ.get("EVE_FRONTIER_TEST_ARCHIVE"),
        "Set EVE_FRONTIER_TEST_ARCHIVE for real bytecode validation",
    )
    def test_supported_archive_patch_preserves_unrelated_members(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "code.ccp"
            with zipfile.ZipFile(os.environ["EVE_FRONTIER_TEST_ARCHIVE"]) as source:
                members = {
                    name: source.read(name)
                    for name in (
                        patcher.MODULE_NAME,
                        patcher.CREATION_SERVICE_MODULE_NAME,
                        patcher.ACTION_PROVIDER_MODULE_NAME,
                        patcher.ACTION_BAR_INTEGRATION_MODULE_NAME,
                        patcher.SKILLSHOT_CONTROLLER_MODULE_NAME,
                        patcher.SKILLSHOT_AUTO_CANNON_MODULE_NAME,
                    )
                }
            with zipfile.ZipFile(archive_path, "w") as archive:
                for name, member in members.items():
                    archive.writestr(name, member)
                archive.writestr("unrelated.pyc", b"preserve exactly")

            self.assertEqual(patcher.inspect_archive(archive_path)[0], "source")
            patcher.patch_archive(archive_path)
            once = archive_path.read_bytes()
            self.assertEqual(patcher.inspect_archive(archive_path)[0], "patched")
            patcher.patch_archive(archive_path)
            self.assertEqual(archive_path.read_bytes(), once)
            with zipfile.ZipFile(archive_path) as result:
                self.assertEqual(result.read("unrelated.pyc"), b"preserve exactly")


if __name__ == "__main__":
    unittest.main()
