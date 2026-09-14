"""Production integration against build 3502403's actual retail bytecode.

Set EVE_FRONTIER_TEST_ARCHIVE to its unmodified code.ccp. Only graphical
primitives and external service data are faked; inventory locations, controller
construction, container dispatch, panel switching and Production layout execute
the native code that exposed the missing SmartStorageUnitInventory registry.
"""

import marshal
import operator
import os
from pathlib import Path
import sys
import types
import unittest
from unittest import mock
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import industry_storage_adapter as adapter

NS = types.SimpleNamespace
ARCHIVE = os.environ.get("EVE_FRONTIER_TEST_ARCHIVE")


class UserError(Exception):
    pass


class Signal:
    def __init__(self):
        self.handlers = []

    def connect(self, callback):
        self.handlers.append(callback)

    def disconnect(self, callback):
        self.handlers.remove(callback)

    def __call__(self, *args):
        for callback in list(self.handlers):
            callback(*args)


@unittest.skipUnless(sys.version_info[:2] == (3, 12) and ARCHIVE,
                     "Set EVE_FRONTIER_TEST_ARCHIVE and use Python 3.12 for native Production integration")
class NativeProductionPanelTests(unittest.TestCase):
    def setUp(self):
        self.archive = zipfile.ZipFile(ARCHIVE)
        self.addCleanup(self.archive.close)
        self.modules = {}
        self.module_patch = mock.patch.dict(sys.modules, self.modules)
        self.module_patch.start()
        self.addCleanup(self.module_patch.stop)
        self.align = NS(TOBOTTOM="bottom", CENTER="center", CENTERBOTTOM="centerbottom", TOALL="all")
        self.module("eveexceptions", UserError=UserError)
        self.storage = NS(assembly_id=200, assembly_type_id=42, assembly_owner_id=99,
                          assembly_name="Nearby Storage", is_owner=True,
                          is_online=lambda: True, on_drop_items=mock.Mock(),
                          items=[NS(type_id=34, quantity=8, is_singleton=False)],
                          smart_storage_attributes=NS(capacity=100, personal_capacity=50),
                          on_inventory_change=Signal(), on_name_changed=Signal(),
                          on_withdraw_items_started=Signal(), on_withdraw_items_completed=Signal())

        class Primitive:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)
                self.destroyed = False

            def Close(self):
                self.destroyed = True

        class ShipCargo:
            def __init__(self, itemID):
                self.itemID = itemID

            def GetInvID(self):
                return ("ShipCargo", self.itemID)

            def GetName(self):
                return "Ship Cargo"

        self.ship = ShipCargo(1)
        registry = self.module("eve.client.script.environment.invControllers", ShipCargo=ShipCargo)
        inv_globals = {"InSpace": lambda: False}
        base_code = self.code("eve/client/script/environment/invControllers.pyc", "BaseInvContainer")
        base = type("BaseInvContainer", (), {name: self.function(base_code, name, inv_globals)
                    for name in ("__init__", "GetInvID", "GetItems")})
        celestial = self.code("eve/client/script/environment/invControllers.pyc", "BaseCelestialContainer")
        base.IsItemHere = self.function(celestial, "IsItemHere", inv_globals)
        types_api = NS(GetName=lambda type_id: "Storage Unit", GetGroupID=lambda _: 1,
                       GetCategoryID=lambda _: 2, GetVolume=lambda _: 1)
        stock_globals = {"BaseCelestialContainer": base, "telemetry": NS(ZONE_METHOD=lambda f: f),
                         "const": NS(flagSmartStorageUnit=66), "evetypes": types_api,
                         "session": NS(charid=99), "utillib": NS(KeyVal=NS), "KeyVal": NS,
                         "GetItemVolume": lambda item: item.stacksize}
        stock_globals["StorageInventoryItem"] = self.native_class(
            "frontier/smart_assemblies/client/storage/smart_storage_inventory.pyc",
            "StorageInventoryItem", stock_globals)
        self.inventory_type = self.native_class(
            "frontier/smart_assemblies/client/storage/smart_storage_inventory.pyc",
            "SmartStorageUnitInventory", stock_globals, (base,))
        adapter._evejs_install_industry_storage(stock_globals, "storage")
        stock_module = self.module("frontier.smart_assemblies.client.storage.smart_storage_inventory",
                                   SmartStorageUnitInventory=self.inventory_type)
        self.inventory = self.inventory_type(self.storage, itemID=200, typeID=42)

        class TreePrimitive:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)
                self._kw = {key: value for key, value in kwargs.items()
                            if key not in ("parent", "children", "label", "isRemovable")}

        tree_globals = {"TreeData": TreePrimitive, "invCtrl": registry,
                        "telemetry": NS(ZONE_METHOD=lambda f: f)}
        tree = self.native_class("eve/client/script/ui/shared/inventory/treeData.pyc", "TreeDataInv",
                                 tree_globals, (TreePrimitive,))
        # Retail TreeDataInv chooses the standard graphical container by name.
        tree_globals["invCont"] = NS(ShipCargo=lambda **kwargs: Primitive(kind="standard", **kwargs))
        resolver = self.function(self.code("eve/client/script/ui/shared/inventory/treeData.pyc"),
                                 "GetTreeDataClassByInvName", tree_globals)
        location_globals = {"signals": NS(Signal=Signal), "GetTreeDataClassByInvName": resolver}
        kinds = self.native_class("frontier/inventory/client/location.pyc", "ItemContainerKind", location_globals)
        location_base = self.native_class("frontier/inventory/client/location.pyc", "InventoryLocation", location_globals)
        self.standard = self.native_class("frontier/inventory/client/location.pyc", "StandardInventoryLocation",
                                          location_globals, (location_base,))
        self.smart = self.native_class("frontier/smart_assemblies/client/storage/location.pyc", "SmartStorageLocation",
                                       {"ItemContainerKind": kinds, "evetypes": types_api}, (location_base,))
        self.module("frontier.smart_assemblies.client.storage.location", SmartStorageLocation=self.smart)

        class InventoryPrimitive(Primitive):
            def __init__(self, **kwargs):
                super().__init__(**kwargs)
                self.refreshes = 0
                self.ApplyAttributes(NS(**kwargs))
                self.invController = self._GetInvController(NS(**kwargs))

            def ApplyAttributes(self, attributes):
                pass

            def Refresh(self):
                self.refreshes += 1

        storage_ui_globals = {"smart_storage_inventory": stock_module, "operator": operator,
                              "UserError": UserError, "uiconst": NS(VK_SHIFT=16),
                              "appConst": NS(ixSingleton=0, ixQuantity=1),
                              "uicore": NS(uilib=NS(Key=lambda _: False))}
        storage_ui = self.native_class("eve/client/script/ui/shared/inventory/invContainers.pyc",
                                        "SmartStorageUnitInventory", storage_ui_globals, (InventoryPrimitive,))
        self.storage_ui = storage_ui
        self.module("eve.client.script.ui.shared.inventory.invContainers", SmartStorageUnitInventory=storage_ui)
        storage_builder = self.function(self.code("frontier/smart_assemblies/client/storage/item_container.pyc"),
                                        "build_smart_storage_container",
                                        {"SmartStorageUnitInventory": storage_ui, "PendingDepositStrip": Primitive,
                                         "Align": self.align, "PENDING_DEPOSIT_STRIP_HEIGHT": 32})
        self.module("frontier.smart_assemblies.client.storage.item_container", build_smart_storage_container=storage_builder)
        factory_globals = {"ItemContainerKind": kinds, "Align": self.align}
        factory_code = self.code("frontier/inventory/client/item_container_factory.pyc")
        factory_globals["_build_standard_container"] = self.function(factory_code, "_build_standard_container", factory_globals)
        factory = self.function(factory_code, "build_item_container", factory_globals)

        class Panel(Primitive):
            def __init__(self, **kwargs):
                super().__init__(**kwargs)
                self._locations = self.locations
                self._current = None
                self._body_slot = NS(Flush=lambda: None)
                self.gauge_refreshes = 0
                self.label_refreshes = 0
                self.on_location_changed = Signal()
                self._inventory_selected_callback = None
                self._switch_to(self.locations[0])

            def _bind_grid(self, container):
                pass

            def _refresh_gauge(self):
                self.gauge_refreshes += 1

            def _refresh_labels(self):
                self.label_refreshes += 1

            def anim_appear(self):
                self.appeared = True

        panel_code = self.code("frontier/inventory/client/panel.pyc", "InventoryPanel")
        for name in ("_switch_to", "_load_body", "_detach_current", "_build_body"):
            setattr(Panel, name, self.function(panel_code, name, {"build_item_container": factory}))
        self.panel_type = Panel

        class Coupler:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)
                self.active = False

            def parent_hinted_shortcuts(self):
                return ["deposit", "withdraw"]

            def activate_shortcuts(self, hints):
                self.active = True

            def deactivate_shortcuts(self):
                self.active = False

        self.namespace = {"StandardInventoryLocation": self.standard, "InventoryPanel": Panel,
                          "ContainerAutoSize": Primitive, "BlueprintCargoCoupler": Coupler,
                          "LocalShortcutHints": lambda *args, **kwargs: NS(destroyed=False, refresh=mock.Mock()),
                          "Align": self.align, "CARGO_PANEL_WIDTH": 900, "CARGO_PANEL_HEIGHT": 310,
                          "CARGO_SHORTCUT_HINTS_TOP": 318}
        self.production = self.native_class("frontier/industry/client/ui/active_blueprint_panel.pyc",
                                            "ActiveBlueprintPanel", self.namespace, (Primitive,))

    def module(self, name, **values):
        pieces = name.split(".")
        for i in range(1, len(pieces) + 1):
            key = ".".join(pieces[:i])
            if key not in self.modules:
                module = types.ModuleType(key)
                module.__path__ = []
                self.modules[key] = module
                sys.modules[key] = module
                if i > 1:
                    setattr(self.modules[".".join(pieces[:i - 1])], pieces[i - 1], module)
        self.modules[name].__dict__.update(values)
        return self.modules[name]

    def code(self, path, name=None):
        code = marshal.loads(self.archive.read(path)[16:])
        return self.child(code, name) if name else code

    def child(self, code, name):
        return next(c for c in code.co_consts if isinstance(c, types.CodeType) and c.co_name == name)

    def function(self, code, name, namespace):
        namespace.setdefault("__builtins__", __builtins__)
        return types.FunctionType(self.child(code, name), namespace)

    def native_class(self, path, name, namespace, bases=(object,)):
        namespace.setdefault("__name__", "native_frontier_regression")
        local = {}
        exec(self.code(path, name), namespace, local)
        result = type(name, bases, local)
        namespace[name] = result
        return result

    def page(self, inventories, display=True, patched=True):
        if patched:
            adapter._evejs_install_industry_storage(self.namespace, "panel")
        page = self.production.__new__(self.production)
        page._controller = NS(get_nearby_inventories=lambda: inventories,
                              facility_instance=NS(on_items_changed=Signal()))
        page._cargo_panel = page._cargo_coupler = page._cargo_hints = None
        page.display = display
        page.built = []
        for part in ("inputs", "outputs", "lines", "center"):
            setattr(page, "_construct_" + part, lambda part=part: page.built.append(part))
        return page

    def test_original_native_layout_reproduces_missing_registry_crash(self):
        page = self.page([self.ship, self.inventory], patched=False)
        with self.assertRaisesRegex(AttributeError, "SmartStorageUnitInventory"):
            page._layout()
        self.assertEqual(page.built, [])
        self.assertIsNone(page._cargo_panel)

    def test_mixed_native_locations_render_production_and_refresh_storage(self):
        page = self.page([self.ship, self.inventory])
        page._layout()
        self.assertEqual(page.built, ["inputs", "outputs", "lines", "center"])
        panel = page._cargo_panel
        self.assertIsInstance(panel.locations[0], self.standard)
        location = panel.locations[1]
        self.assertIsInstance(location, self.smart)
        self.assertEqual(location.key, ("ssu", 200))
        self.assertIs(location.storage_controller, self.storage)
        self.assertEqual(location.get_label(), "Nearby Storage")
        self.assertTrue(page._cargo_coupler.active)
        self.assertEqual(panel.pos, (0, 0, 900, 310))
        panel._switch_to(location)
        self.assertIs(panel.inv_cont.ss_controller, self.storage)
        self.assertIs(panel.invController.smart_storage_controller, self.storage)
        self.assertEqual(panel.invController.GetCapacity().used, 8)
        self.storage.items[0].quantity = 3
        self.storage.on_inventory_change(200)
        self.assertEqual(panel.inv_cont.refreshes, 1)
        self.assertEqual(panel.gauge_refreshes, 1)
        self.assertEqual(panel.invController.GetCapacity().used, 3)
        self.storage.assembly_name = "Renamed Storage"
        self.storage.on_name_changed()
        self.assertEqual(panel.label_refreshes, 1)
        self.assertEqual(location.get_label(), "Renamed Storage")
        panel._detach_current()
        self.storage.on_inventory_change(200)
        self.storage.on_name_changed()
        self.assertEqual(panel.gauge_refreshes, 1)
        self.assertEqual(panel.label_refreshes, 1)
        page.Close()
        self.assertFalse(page._cargo_coupler.active)
        self.assertEqual(page._controller.facility_instance.on_items_changed.handlers, [])

    def test_ship_only_preserves_standard_container_and_hidden_shortcuts(self):
        page = self.page([self.ship], display=False)
        page._layout()
        self.assertEqual(page._cargo_panel.inv_cont.kind, "standard")
        self.assertEqual(page._cargo_panel.invID, ("ShipCargo", 1))
        self.assertFalse(page._cargo_coupler.active)
        page.activate_shortcuts()
        self.assertTrue(page._cargo_coupler.active)

    def test_native_storage_grid_routes_industry_callbacks_and_preserves_regular_drops(self):
        callback = mock.Mock()
        node = NS(__guid__="IndustryItemDragData", on_add_item=callback)
        # The retail grid silently ignores Industry callback nodes with no item.
        original_grid = self.storage_ui(itemID=200, ss_controller=self.storage)
        original_grid.OnDropData(None, [node])
        callback.assert_not_called()
        page = self.page([self.ship, self.inventory])
        page._layout()
        installed = self.storage_ui.OnDropData
        adapter._evejs_patch_industry_storage_grid()
        self.assertIs(self.storage_ui.OnDropData, installed, "Installing twice must not wrap the grid twice")
        page._cargo_panel._switch_to(page._cargo_panel.locations[1])
        grid = page._cargo_panel.inv_cont
        grid.OnDropData(None, [node])
        callback.assert_called_once_with(grid.invController)
        callback.reset_mock()
        escrow = NS(__guid__="xtriui.EscrowInvItem", on_add_item=callback)
        grid.OnDropData(None, [escrow])
        callback.assert_called_once_with(grid.invController)
        # Native inventory rows expose indexed singleton/quantity fields.
        regular_item = {0: False, 1: 5}
        regular = NS(item=regular_item)
        grid.OnDropData(None, [regular])
        self.storage.on_drop_items.assert_called_once_with([regular_item], None)
        callback.reset_mock()
        with self.assertRaisesRegex(UserError, "CannotAddToThatLocation"):
            grid.OnDropData(None, [node, regular])
        callback.assert_not_called()
        self.storage.is_online = lambda: False
        with self.assertRaisesRegex(UserError, "SmartStorageOffline"):
            grid.OnDropData(None, [node])
        callback.assert_not_called()
        self.storage.on_drop_items.assert_called_once()

    def test_no_nearby_inventory_still_constructs_production(self):
        page = self.page([])
        page._layout()
        self.assertIsNone(page._cargo_panel)
        self.assertEqual(page.built, ["inputs", "outputs", "lines", "center"])
        self.assertEqual(page._controller.facility_instance.on_items_changed.handlers, [])


if __name__ == "__main__":
    unittest.main()
