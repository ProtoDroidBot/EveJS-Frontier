"""Client adapter coverage for server-authoritative Smart Industry job lanes."""

import logging
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import industry_storage_adapter as adapter


class Facility:
    def __init__(self):
        self.loading_details = False
        self.requesting = False
        self.details_fetched = True
        self.production = None
        self.blueprint = None
        self.inputs = None
        self.outputs = None

    def set_details_state(self, loading, error=False):
        self.loading_details = loading

    def update_production(self, production):
        self.production = production

    def update_item_stacks(self, input_items, output_items):
        self.inputs = input_items
        self.outputs = output_items

    def update_blueprint(self, blueprint):
        self.blueprint = (types.SimpleNamespace(**blueprint)
                          if isinstance(blueprint, dict) else blueprint)

    def on_blueprint_changed(self):
        pass


class ClientLaneTests(unittest.TestCase):
    def test_deployed_and_creation_strategies_forward_the_selected_lane(self):
        remote = mock.Mock()

        class AssemblyClientFacility:
            pass

        adapter._evejs_patch_industry_lane_strategy({"AssemblyClientFacility": AssemblyClientFacility})
        deployed = AssemblyClientFacility()
        deployed.facility_id = 88
        deployed._remote_service = remote
        deployed._evejs_selected_lane_id = 3
        deployed.load_blueprint(101)
        deployed.deposit_input_items({44: 2})
        deployed.withdraw_input_items({44: 1}, 99, 5)
        deployed.withdraw_output_items({55: 1}, 99, 5)
        deployed.start_production(101, "hash")
        deployed.discontinue_production()
        remote.load_blueprint.assert_called_once_with(88, 101, 3)
        remote.deposit_input_items.assert_called_once_with(88, {44: 2}, 3)
        remote.withdraw_input_items.assert_called_once_with(88, {44: 1}, 99, 5, 3)
        remote.withdraw_output_items.assert_called_once_with(88, {55: 1}, 99, 5, 3)
        remote.start_production.assert_called_once_with(88, 101, "hash", None, 3)
        remote.discontinue_production.assert_called_once_with(88, 3)

        class CreationModuleClientFacility:
            def _activate(self, ability, **kwargs):
                return ability, kwargs

        abilities = types.SimpleNamespace(
            INDUSTRY_START_PRODUCTION="start",
            INDUSTRY_DISCONTINUE_PRODUCTION="stop",
        )
        adapter._evejs_patch_industry_modular_lane_strategy({
            "CreationModuleClientFacility": CreationModuleClientFacility,
            "AbilityId": abilities,
        })
        creation = CreationModuleClientFacility()
        creation._evejs_selected_lane_id = 2
        self.assertEqual(creation.start_production(101, "hash"),
                         ("start", {"blueprint_id": 101, "blueprint_hash": "hash", "lane_id": 2}))
        self.assertEqual(creation.discontinue_production(), ("stop", {"lane_id": 2}))

    def test_service_selects_lane_state_refreshes_notices_and_exposes_access_configuration(self):
        strategy = types.SimpleNamespace()
        facility = Facility()
        threads = types.SimpleNamespace(start_tasklet=lambda callback, *args: callback(*args))

        class IndustryService:
            __notifyevents__ = []

            def __init__(self):
                self._facilities = {88: facility}
                self._strategies = {88: strategy}

            def get_facility_strategy(self, facility_id):
                return self._strategies[facility_id]

            def start_production(self, facility_id):
                return ("start", facility_id, getattr(self._strategies[facility_id],
                                                       "_evejs_selected_lane_id", None))

            def discontinue_production(self, facility_id):
                return ("stop", facility_id, getattr(self._strategies[facility_id],
                                                      "_evejs_selected_lane_id", None))

            def load_blueprint(self, facility_id, blueprint_id):
                return facility_id, blueprint_id

            def _on_blueprint_changed(self, *_args):
                pass

        details = {
            "production": {"state": "RUNNING", "legacy": True},
            "job_lane_count": 3,
            "job_lanes": [
                {"lane_id": 1, "enabled": True, "can_use": True,
                 "production": {"state": "RUNNING", "lane": 1},
                 "items": {"inputs": {11: 2}, "outputs": {12: 1}},
                 "blueprint": {"blueprint_id": 101}},
                {"lane_id": 2, "enabled": True, "can_use": True,
                 "production": {"state": "STOPPED", "lane": 2},
                 "items": {"inputs": {}, "outputs": {}},
                 "blueprint": {"blueprint_id": 202}},
                {"lane_id": 3, "enabled": True, "can_use": False,
                 "production": None},
            ],
            "items": {"inputs": {}, "outputs": {}},
            "blueprint": None,
        }
        remote = types.SimpleNamespace(
            get_facility_details=mock.Mock(return_value=details),
            set_job_lane_access=mock.Mock(return_value={"lane_id": 2}),
        )
        namespace = {
            "IndustryService": IndustryService,
            "uthread2": threads,
            "IndustryError": type("IndustryError", (Exception,), {}),
            "ErrorReason": types.SimpleNamespace(FACILITY_NOT_FOUND="missing", GENERIC="generic"),
            "ErrorHeaders": types.SimpleNamespace(DETAILS="details"),
            "logger": logging.getLogger(__name__),
            "prompt_error_message": mock.Mock(),
        }
        adapter._evejs_patch_industry_service(namespace)
        service = IndustryService()
        service._remote_service = remote
        service._request_facility_details(88, facility)
        self.assertEqual(facility.production, {"state": "RUNNING", "lane": 1})
        self.assertEqual(facility.inputs, {11: 2})
        self.assertEqual(facility.outputs, {12: 1})
        self.assertEqual(facility.blueprint.blueprint_id, 101)
        self.assertEqual(facility._evejs_job_lane_count, 3)
        self.assertTrue(service.select_job_lane(88, 2))
        self.assertEqual(facility.production, {"state": "STOPPED", "lane": 2})
        self.assertEqual(facility.inputs, {})
        self.assertEqual(facility.outputs, {})
        self.assertEqual(facility.blueprint.blueprint_id, 202)
        self.assertFalse(service.select_job_lane(88, 3), "a lane without use access is not selectable")
        self.assertEqual(service.start_production(88), ("start", 88, 2))
        self.assertEqual(service.discontinue_production(88), ("stop", 88, 2))
        service.set_job_lane_access(88, 2, "allowlist", [99], [7])
        remote.set_job_lane_access.assert_called_once_with(88, 2, {
            "mode": "allowlist", "character_ids": [99], "tribe_ids": [7],
        })
        self.assertIn("OnFrontierIndustryJobLaneChanged", IndustryService.__notifyevents__)
        service.OnFrontierIndustryJobLaneChanged(88, 2, "stopped")
        self.assertGreaterEqual(remote.get_facility_details.call_count, 3)

    def test_production_panel_builds_a_selector_for_enabled_lanes(self):
        class ActiveBlueprintPanel:
            def _construct_center(self):
                self.center_constructed = True

        class Group:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)
                self.buttons = []
                self.selected = None

            def AddButton(self, lane_id, label, isDisabled=False):
                self.buttons.append((lane_id, label, isDisabled))

            def SelectByID(self, lane_id):
                self.selected = lane_id

        module_names = [
            "eve",
            "eve.client",
            "eve.client.script",
            "eve.client.script.ui",
            "eve.client.script.ui.control",
        ]
        modules = {name: types.ModuleType(name) for name in module_names}
        for module in modules.values():
            module.__path__ = []
        toggle_name = "eve.client.script.ui.control.floatingToggleButtonGroup"
        toggle = types.ModuleType(toggle_name)
        toggle.FloatingToggleButtonGroup = Group
        modules[toggle_name] = toggle
        service = types.SimpleNamespace(
            get_job_lanes=lambda _facility_id: [
                {"lane_id": 1, "enabled": True, "can_use": True, "production": None},
                {"lane_id": 2, "enabled": True, "can_use": True,
                 "production": {"state": "RUNNING"}},
                {"lane_id": 3, "enabled": True, "can_use": False, "production": None},
            ],
            select_job_lane=mock.Mock(return_value=True),
        )
        namespace = {"ActiveBlueprintPanel": ActiveBlueprintPanel,
                     "Align": types.SimpleNamespace(CENTERTOP="centertop")}
        with mock.patch.dict(sys.modules, modules):
            adapter._evejs_patch_industry_lane_panel(namespace)
            panel = ActiveBlueprintPanel()
            panel._controller = types.SimpleNamespace(
                _service=service,
                _facility_id=88,
                facility_instance=types.SimpleNamespace(_evejs_selected_lane_id=2),
            )
            panel._construct_center()
        self.assertTrue(panel.center_constructed)
        self.assertEqual(panel._evejs_lane_group.selected, 2)
        self.assertEqual(panel._evejs_lane_group.buttons, [
            (1, "LANE 1", False),
            (2, "LANE 2 [ACTIVE]", False),
            (3, "LANE 3", True),
        ])


if __name__ == "__main__":
    unittest.main()
