"""Blueprint refresh regression using the actual build-3502403 retail models/UI."""

import logging
import marshal
import os
from pathlib import Path
import sys
import types
import typing
import unittest
from unittest import mock
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import industry_storage_adapter as adapter

NS = types.SimpleNamespace
ARCHIVE = os.environ.get("EVE_FRONTIER_TEST_ARCHIVE")


class Signal:
    def __init__(self, *args):
        self.handlers = []

    def connect(self, callback):
        self.handlers.append(callback)

    def disconnect(self, callback):
        self.handlers.remove(callback)

    def clear(self):
        self.handlers.clear()

    def __call__(self, *args):
        for callback in list(self.handlers):
            callback(*args)


class IndustryError(Exception):
    def __init__(self, msg):
        self.msg = msg


@unittest.skipUnless(sys.version_info[:2] == (3, 12) and ARCHIVE,
                     "Set EVE_FRONTIER_TEST_ARCHIVE and use Python 3.12 for native blueprint integration")
class NativeBlueprintSyncTests(unittest.TestCase):
    def setUp(self):
        self.archive = zipfile.ZipFile(ARCHIVE)
        self.addCleanup(self.archive.close)
        self.queue = []
        self.threads = NS(start_tasklet=lambda callback, *args: self.queue.append((callback, args)),
                          debounce=lambda _: lambda function: function, sleep=mock.Mock())
        self.namespace = {"__name__": "native_blueprint_sync", "t": typing, "Signal": Signal,
                          "uthread2": self.threads, "REFRESH_TIME": 60,
                          "gametime": NS(GetWallclockTime=lambda: 100, GetSecondsSinceWallclockTime=lambda _: 0),
                          "logger": logging.getLogger("native_blueprint_sync"),
                          "IndustryError": IndustryError,
                          "ErrorReason": NS(FACILITY_NOT_FOUND="missing", GENERIC="generic"),
                          "ErrorHeaders": NS(DETAILS="details", LOAD="load"),
                          "prompt_error_message": mock.Mock()}
        module = types.ModuleType(self.namespace["__name__"])
        module.__dict__.update(self.namespace)
        self.namespace = module.__dict__
        module_patch = mock.patch.dict(sys.modules, {module.__name__: module})
        module_patch.start()
        self.addCleanup(module_patch.stop)
        exec(marshal.loads(self.archive.read("frontier/industry/common/model.pyc")[16:]), self.namespace)
        self.namespace["Signal"] = Signal
        self.namespace["get_remaining_input_runs"] = lambda slots, items: min(
            items.get(key, 0) // slot.quantity_per_run for key, slot in slots.items())
        self.namespace["get_remaining_output_runs"] = lambda slots, items: min(
            (slot.max_storable_quantity - items.get(key, 0)) // slot.quantity_per_run for key, slot in slots.items())
        self.Facility = self.native_class("frontier/industry/client/facility_instance.pyc", "IndustryFacilityInstance")
        self.namespace.update({name: object for name in ("Michelle", "PublicGatewaySvc", "FrontierHudService",
                                                        "IndustryListener", "IndustryMockListener", "ClientIndustryFacility",
                                                        "BlueprintTracker")})
        self.Service = self.native_class("frontier/industry/client/industry_svc.pyc", "IndustryService")
        self.service = self.Service()
        self.facility = self.Facility(100, 42)
        self.service._facilities = {100: self.facility}
        self.service._strategies = {100: NS(load_blueprint=lambda _: self.new)}
        self.old = self.recipe(1340, 90, 30)
        self.new = self.recipe(1013, 10, 2)
        self.facility.update_blueprint(self.old)
        self.facility.set_details_state(False)
        self.remote = mock.Mock(return_value=self.details(self.new))
        self.service._remote_service = NS(get_facility_details=self.remote)
        self.namespace["sm"] = NS(GetService=lambda _: self.service, RegisterForNotifyEvent=mock.Mock(),
                                   UnregisterForNotifyEvent=mock.Mock())

    def native_class(self, path, name):
        root = marshal.loads(self.archive.read(path)[16:])
        code = next(value for value in root.co_consts if isinstance(value, types.CodeType) and value.co_name == name)
        local = {}
        exec(code, self.namespace, local)
        result = type(name, (object,), local)
        self.namespace[name] = result
        return result

    def native_function(self, path, class_name, name):
        root = marshal.loads(self.archive.read(path)[16:])
        parent = next(value for value in root.co_consts if isinstance(value, types.CodeType) and value.co_name == class_name)
        child = next(value for value in parent.co_consts if isinstance(value, types.CodeType) and value.co_name == name)
        return types.FunctionType(child, self.namespace)

    def recipe(self, identifier, seconds, quantity):
        return {"blueprint_id": identifier, "run_time": seconds,
                "inputs": {34: {"type_id": 34, "quantity_per_run": quantity, "max_storable_quantity": quantity * 100}},
                "outputs": {35: {"type_id": 35, "quantity_per_run": 1, "max_storable_quantity": 100}}}

    def details(self, blueprint):
        return {"blueprint": blueprint, "production": {"state": "IDLE"}, "items": {"inputs": {}, "outputs": {}}}

    def patch(self):
        adapter._evejs_install_industry_storage(self.namespace, "service")

    def drain(self):
        for _ in range(20):
            if not self.queue:
                return
            callback, args = self.queue.pop(0)
            callback(*args)
        self.fail("refresh did not settle within 20 tasklets")

    def controller(self):
        self.namespace["get_facility"] = lambda _: NS(blueprints={})
        self.native_class("frontier/industry/client/ui/controller.pyc", "ItemSlotController")
        controller_type = self.native_class("frontier/industry/client/ui/controller.pyc", "FacilityPageController")
        controller = controller_type(100, 42)
        self.assertEqual(self.queue, [], "retail cache should suppress the initial details fetch")
        return controller

    def test_retail_item_notices_leave_recipe_stale_but_explicit_notice_rebuilds_native_slots_and_panel(self):
        controller = self.controller()
        panel = NS(Close=mock.Mock())
        page = NS(_controller=controller, _active_panel=panel, _active_blueprint_tab=NS(isDisabled=False),
                  _tab_group=NS(SelectByID=mock.Mock()))
        handler = self.native_function("frontier/industry/client/ui/page.pyc", "IndustryFacilityPage", "_on_active_blueprint_changed")
        controller.on_active_blueprint_changed.connect(lambda: handler(page))
        self.service._on_input_items_changed(100, {})
        self.assertEqual(controller.active_blueprint.blueprint_id, 1340)
        self.remote.assert_not_called()
        self.patch()
        self.assertIn("OnSessionChanged", self.Service.__notifyevents__)
        self.assertEqual(self.Service.__notifyevents__.count("OnFrontierIndustryBlueprintChanged"), 1)
        self.service.OnFrontierIndustryBlueprintChanged(100)
        self.drain()
        self.assertEqual(controller.active_blueprint.blueprint_id, 1013)
        self.assertEqual(controller.active_blueprint.run_time, 10)
        self.assertEqual(controller.input_slots[0].quantity_per_run, 2)
        panel.Close.assert_called_once()
        page._tab_group.SelectByID.assert_called_once_with("production")

    def test_notice_during_old_read_discards_response_and_coalesces_one_fresh_read(self):
        self.patch()
        seen = []
        self.facility.on_blueprint_changed.connect(lambda: seen.append(self.facility.blueprint_id))
        def first(_):
            self.service.OnFrontierIndustryBlueprintChanged(100)
            self.service.OnFrontierIndustryBlueprintChanged(100)
            return self.details(self.recipe(777, 45, 1))
        self.remote.side_effect = lambda identifier: first(identifier) if self.remote.call_count == 1 else self.details(self.new)
        self.service.refresh_facility_details(100)
        self.drain()
        self.assertEqual(self.remote.call_count, 2)
        self.assertEqual(seen, [1013])

    def test_native_load_racing_details_does_not_restore_old_blueprint(self):
        self.patch()
        def fetch(_):
            self.service.load_blueprint(100, 1013)
            return self.details(self.old)
        self.remote.side_effect = lambda identifier: fetch(identifier) if self.remote.call_count == 1 else self.details(self.new)
        self.service.refresh_facility_details(100)
        self.drain()
        self.assertEqual(self.facility.blueprint_id, 1013)
        self.assertEqual(self.remote.call_count, 2)
        self.assertFalse(self.facility.requesting)

    def test_old_session_response_cannot_update_replacement_cached_instance(self):
        self.patch()
        replacement = self.Facility(100, 42)
        replacement.update_blueprint(self.old)
        def fetch(_):
            self.service._facilities = {100: replacement}
            return self.details(self.new)
        self.remote.side_effect = fetch
        self.service.refresh_facility_details(100)
        self.drain()
        self.assertEqual(replacement.blueprint_id, 1340)
        self.assertEqual(self.facility.blueprint_id, 1340)
        self.service.OnFrontierIndustryBlueprintChanged(999)
        self.assertEqual(self.queue, [])

    def test_notice_received_inside_native_load_waits_for_load_to_finish(self):
        self.patch()
        def load(_):
            self.assertTrue(self.facility.requesting)
            self.service.OnFrontierIndustryBlueprintChanged(100)
            self.assertEqual(self.queue, [])
            return self.new
        self.service._strategies[100].load_blueprint = load
        self.service.load_blueprint(100, 1013)
        self.assertFalse(self.facility.requesting)
        self.assertEqual(len(self.queue), 1)
        self.drain()
        self.remote.assert_called_once_with(100)
        self.assertEqual(self.facility.blueprint_id, 1013)

    def test_same_id_changed_content_rebuilds_recipe_and_read_failure_keeps_last_good_state(self):
        self.patch()
        changes = mock.Mock()
        self.facility.on_blueprint_changed.connect(changes)
        self.remote.return_value = self.details(self.recipe(1340, 15, 8))
        self.service.refresh_facility_details(100)
        self.drain()
        self.assertEqual(self.facility.blueprint.run_time, 15)
        changes.assert_called_once()
        self.remote.side_effect = IndustryError("unavailable")
        self.service.refresh_facility_details(100)
        with self.assertLogs("native_blueprint_sync", level="WARNING"):
            self.drain()
        self.assertEqual(self.facility.blueprint.run_time, 15)
        self.assertFalse(self.facility.loading_details)
        self.namespace["prompt_error_message"].assert_not_called()

    def test_open_page_refreshes_immediately_retries_missed_notice_and_stops_after_close(self):
        self.patch()
        controller = self.controller()
        controller.close()
        adapter._evejs_patch_industry_refresh_loop(self.namespace)
        self.namespace["FacilityPageController"](100, 42)
        callback, args = self.queue.pop()
        live = args[0]
        ticks = []
        def sleep(seconds):
            ticks.append(seconds)
            self.drain()
            if len(ticks) == 1:
                self.remote.return_value = self.details(self.recipe(777, 45, 1))
            else:
                live.close()
        self.threads.sleep = sleep
        callback(*args)
        self.assertEqual(ticks, [3, 3])
        self.assertEqual(self.remote.call_count, 2)
        self.assertEqual(self.facility.blueprint_id, 777)
        self.assertEqual(self.queue, [])
        self.assertEqual(self.facility.on_blueprint_changed.handlers, [])


if __name__ == "__main__":
    unittest.main()
