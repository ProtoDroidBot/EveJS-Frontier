"""Repeated Open must preserve the live ROOT browser and its task document.

Uses retail Open/initialize/layout, IndustryFacilityPage.Close and Browser.Close
bytecode. Only the generic UI tree and service dependencies are substituted.
"""

import hashlib
import marshal
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
WINDOW = "frontier/smart_assemblies/client/window/window.pyc"
WINDOW_SHA256 = "a99b1764101b4ce954cb141c170094ddb044a2980d5d97ebda0702cb793d5f35"


class Container:
    def __init__(self, **kwargs):
        self.destroyed = False
        self.children = []

    def Close(self, *args, **kwargs):
        for child in self.children:
            child.Close()
        self.children = []
        self.destroyed = True


@unittest.skipUnless(sys.version_info[:2] == (3, 12) and ARCHIVE,
                     "Set EVE_FRONTIER_TEST_ARCHIVE and use Python 3.12 for native window integration")
class NativeIndustryWindowReopenTests(unittest.TestCase):
    def setUp(self):
        self.archive = zipfile.ZipFile(ARCHIVE)
        self.addCleanup(self.archive.close)
        window_member = self.archive.read(WINDOW)
        if hashlib.sha256(window_member).hexdigest() != WINDOW_SHA256:
            wrapper = marshal.loads(window_member[16:])
            originals = [value for value in wrapper.co_consts if isinstance(value, bytes)
                         and hashlib.sha256(value).hexdigest() == WINDOW_SHA256]
            self.assertEqual(len(originals), 1, "Archive does not contain the exact supported native assembly window")
        self.facilities = {}
        self.wallet = NS(create_wallet_provider_extension=mock.Mock(return_value=object()))
        self.interaction = mock.Mock()
        self.base_opens = []
        self.namespace = {"__name__": "native_industry_window_reopen",
                          "sm": NS(GetService=lambda _: NS(on_interaction=self.interaction)),
                          "_is_owned_industry_facility": lambda type_id, owner_id: type_id == 42 and owner_id == 7,
                          "_is_owned_smart_hangar": lambda *_: False,
                          "is_industry_facility": lambda type_id: type_id == 42,
                          "HasSmartStorageUnitComponent": lambda _: False,
                          "Align": NS(TOALL=1, CENTER_STRETCH_VERTICAL=2, TOLEFT=3),
                          "ContainerAutoSize": Container}
        test = self

        class Browser(Container):
            def __init__(self):
                super().__init__()
                self._browser_texture = object()
                self._browser = NS(task_queue=[], route="overview")
                self._extensions = [NS(dispose=mock.Mock())]

        self.native_method(Browser, "carbonui/primitives/browser.pyc", "Close")

        class IndustryFacilityPage(Container):
            def __init__(self, assembly_controller, **kwargs):
                super().__init__()
                self._assembly_controller = assembly_controller
                facility = test.facilities.setdefault(assembly_controller.item_id, object())
                self._controller = NS(_evejs_refresh_closed=False, _facility_instance=facility,
                                      _service=NS(_facilities=test.facilities))
                self._controller.close = lambda: setattr(self._controller, "_evejs_refresh_closed", True)
                self._unregister = mock.Mock()
                self.browser = Browser()
                self.children = [self.browser]

        self.native_method(IndustryFacilityPage, "frontier/industry/client/ui/page.pyc", "Close")

        class DockablePanel(Container):
            @classmethod
            def Open(cls, **kwargs):
                test.base_opens.append(kwargs)
                return test.window

        class AssemblyDockablePanel(DockablePanel):
            pass

        for name in ("Open", "initialize", "_layout", "_deactivate"):
            self.native_method(AssemblyDockablePanel, WINDOW, name, classmethod_=name == "Open")
        self.Panel = AssemblyDockablePanel

        def make_controller(item_id, type_id, owner_id, inventory_item_id, wallet_provider_extension):
            return NS(item_id=item_id, type_id=type_id, owner_id=owner_id, is_owner=owner_id == 7,
                      inventory_item_id=inventory_item_id, name="Mini Printer", on_name_changed=NS(connect=mock.Mock()),
                      on_custom_url_changed=NS(connect=mock.Mock()), on_not_in_range=NS(connect=mock.Mock()))

        def make_integration(controller):
            integration = NS(controller=controller, _active=True)
            integration.deactivate = lambda: setattr(integration, "_active", False)
            return integration

        self.namespace.update(AssemblyController=make_controller, AssemblyIntegration=make_integration)
        self.window = self.Panel()
        self.window.controller = self.window.integration = self.window.main_container = None
        self.window.sr = NS(main=object())
        for name in ("_teardown_storage_coupler", "_update_selection_buttons", "_on_name_changed",
                     "_on_custom_url_changed", "_on_not_in_range", "_construct_base_configuration",
                     "_construct_main", "_construct_ship_cargo"):
            setattr(self.window, name, mock.Mock())

    def native_method(self, target, path, name, classmethod_=False):
        code = marshal.loads(self.archive.read(path)[16:])
        # The staged archive may already carry the exact adapter wrapper.
        originals = [value for value in code.co_consts if isinstance(value, bytes) and value[:4] == self.archive.read(path)[:4]]
        if originals:
            code = marshal.loads(originals[0][16:])
        cls = next(value for value in code.co_consts if isinstance(value, types.CodeType) and value.co_name == target.__name__)
        child = next(value for value in cls.co_consts if isinstance(value, types.CodeType) and value.co_name == name)
        self.namespace[target.__name__] = target
        closure = ((lambda: target).__closure__[0],) if child.co_freevars else None
        function = types.FunctionType(child, self.namespace, closure=closure)
        setattr(target, name, classmethod(function) if classmethod_ else function)

    def open(self, **changes):
        args = dict(item_id=100, type_id=42, owner_id=7, sui_wallet=self.wallet)
        args.update(changes)
        return self.Panel.Open(**args)

    def patch(self):
        adapter._evejs_install_industry_storage(self.namespace, "assembly_window")

    def queue_tasks(self):
        page = self.window.main_container
        page.browser._browser.task_queue = ["deposit 1 silica", "deposit 79 silica", "start production"]
        page.browser._browser.route = "industry"
        return page, page.browser, page.browser._browser

    def test_retail_repeat_open_disposes_the_running_root_document_without_changing_target(self):
        self.open()
        page, browser, document = self.queue_tasks()
        self.open()
        self.assertTrue(page.destroyed)
        self.assertTrue(page._controller._evejs_refresh_closed)
        self.assertTrue(browser.destroyed)
        self.assertIsNone(browser._browser)
        self.assertIsNot(self.window.main_container, page)
        self.assertEqual(self.window.main_container.browser._browser.task_queue, [])
        self.assertEqual(self.window.main_container.browser._browser.route, "overview")
        self.assertEqual(self.interaction.call_args_list, [mock.call(100), mock.call(100)])

    def test_repeat_open_keeps_document_queue_controller_and_integration_while_still_focusing_and_notifying(self):
        self.patch()
        self.open()
        page, browser, document = self.queue_tasks()
        controller, integration = self.window.controller, self.window.integration
        self.open()
        self.assertIs(self.window.main_container, page)
        self.assertIs(self.window.controller, controller)
        self.assertIs(self.window.integration, integration)
        self.assertIs(browser._browser, document)
        self.assertFalse(page.destroyed)
        self.assertEqual(len(document.task_queue), 3)
        self.assertEqual(document.route, "industry")
        self.assertEqual(len(self.base_opens), 2)
        self.assertEqual(self.interaction.call_args_list, [mock.call(100), mock.call(100)])
        self.assertEqual(self.window._update_selection_buttons.call_count, 2)
        self.wallet.create_wallet_provider_extension.assert_called_once()

    def test_new_target_owner_type_or_wallet_rebuilds_using_the_retail_path(self):
        self.patch()
        for changed in ({"item_id": 101}, {"type_id": 43}, {"owner_id": 8},
                        {"sui_wallet": NS(create_wallet_provider_extension=lambda: object())}):
            with self.subTest(changed=changed):
                self.open()
                page, browser, document = self.queue_tasks()
                self.open(**changed)
                self.assertTrue(page.destroyed)
                self.assertIsNot(self.window.main_container, page)

    def test_inactive_missing_destroyed_or_stale_state_rebuilds(self):
        self.patch()
        mutations = {
            "destroyed window": lambda: setattr(self.window, "destroyed", True),
            "destroyed page": lambda: setattr(self.window.main_container, "destroyed", True),
            "missing integration": lambda: setattr(self.window, "integration", None),
            "inactive integration": lambda: setattr(self.window.integration, "_active", False),
            "old integration controller": lambda: setattr(self.window.integration, "controller", object()),
            "old page controller": lambda: setattr(self.window.main_container, "_assembly_controller", object()),
            "closed page controller": lambda: setattr(self.window.main_container._controller, "_evejs_refresh_closed", True),
            "replaced session facility": lambda: self.facilities.update({100: object()}),
        }
        for reason, mutate in mutations.items():
            with self.subTest(reason=reason):
                self.window.destroyed = False
                self.open()
                page, browser, document = self.queue_tasks()
                mutate()
                self.open()
                self.assertTrue(page.destroyed)
                self.assertIsNone(browser._browser)
                self.assertIsNot(self.window.main_container, page)


if __name__ == "__main__":
    unittest.main()
