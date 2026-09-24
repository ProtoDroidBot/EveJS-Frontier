"""Regression coverage for non-modular fitting in Frontier build 3502403."""

import builtins
import hashlib
import importlib.util
import json
import marshal
import os
from datetime import timedelta
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
import npc_fitting_menu_adapter as npc_menu_adapter  # noqa: E402
import npc_primary_action_adapter as npc_primary_adapter  # noqa: E402
import action_bar_compatibility_adapter as action_bar_adapter  # noqa: E402
import action_bar_deactivation_adapter as deactivation_adapter  # noqa: E402
import action_bar_selection_adapter as selection_adapter  # noqa: E402
import creation_service_compatibility_adapter as service_adapter  # noqa: E402
import patch_frontier_fitting as patcher  # noqa: E402
import frontier_windows_client as windows  # noqa: E402


NS = types.SimpleNamespace


class EscrowTreeBridgeTests(unittest.TestCase):
    def test_escrow_nodes_use_the_native_facility_controller(self):
        facility = object()
        calls = []

        class EscrowNode:
            def __init__(self, module_id):
                self._module_item_id = module_id
                self._module_type_id = 95302
                self._creation_id = 700

            def GetInvCont(self):
                return "native escrow container"

        class EscrowController:
            def __init__(self, instance, module_id, type_id):
                calls.append((instance, module_id, type_id))

            def GetInvID(self):
                return ("EscrowSection", calls[-1][1])

        def get_facility(module_id, type_id, creation_id):
            calls.append((module_id, type_id, creation_id))
            return facility

        self.assertTrue(adapter._evejs_patch_escrow_tree_node(
            EscrowNode, EscrowController, get_facility,
        ))
        node = EscrowNode(42)
        controller = node.invController
        self.assertIs(node.invController, controller)
        self.assertEqual(controller.GetInvID(), ("EscrowSection", 42))
        self.assertEqual(calls, [
            (42, 95302, 700), (facility, 42, 95302),
        ])
        self.assertEqual(node.GetInvCont(), "native escrow container")
        self.assertFalse(adapter._evejs_patch_escrow_tree_node(
            EscrowNode, EscrowController, get_facility,
        ))

    def test_failed_escrow_facility_does_not_block_another_node(self):
        available = {1: False}

        class EscrowNode:
            def __init__(self, module_id):
                self._module_item_id = module_id
                self._module_type_id = 95302
                self._creation_id = 700

        class EscrowController:
            def __init__(self, facility, module_id, _type_id):
                self.facility = facility
                self.itemID = module_id

        def get_facility(module_id, _type_id, _creation_id):
            if module_id == 1 and not available[1]:
                raise RuntimeError("facility unavailable")
            return "facility"

        adapter._evejs_patch_escrow_tree_node(
            EscrowNode, EscrowController, get_facility,
        )
        first = EscrowNode(1)
        self.assertEqual(first.invController.itemID, 1)
        self.assertIsNone(first.invController.facility)
        self.assertEqual(EscrowNode(2).invController.facility, "facility")
        available[1] = True
        self.assertEqual(first.invController.facility, "facility")


class ActionBarDeactivationVisualTests(unittest.TestCase):
    def test_manual_stop_hides_repeat_arrow_but_keeps_cycle_outline(self):
        class Active:
            def __init__(self, repeat):
                self.repeat = repeat
                self.start_time = 10
                self.duration = 5

        class Idle:
            pass

        class Slot:
            def __init__(self, state):
                self._slot = NS(action=NS(_module_interactor=NS(
                    _state=state,
                    _pending_reactivation_request=None,
                )))
                self._repeat_icon = NS(color=None)
                self._progress_indicator = NS(color="cycle ring", background_color="outline")
                self.repeat_updates = 0

            def _get_repeat_icon_color(self):
                return (
                    "arrow"
                    if isinstance(state.value, Active) and state.value.repeat
                    else "clear"
                )

            def _on_repeat_changed(self, *_args):
                self.repeat_updates += 1

            def _update_repeat_icon_color(self):
                self._repeat_icon.color = self._get_repeat_icon_color()

        deactivation_adapter._evejs_install_action_bar_deactivation({
            "ActionBarSlot": Slot,
            "HudColor": NS(CONTENT_HIGHLIGHT=NS(with_alpha=lambda alpha: ("clear", alpha))),
        })
        state = NS(server_value=Active(True), value=Active(True), client_value=Active(True))
        slot = Slot(state)
        self.assertEqual(slot._get_repeat_icon_color(), "arrow")

        state.value = Active(False)
        slot._on_repeat_changed()
        self.assertEqual(slot.repeat_updates, 1)
        self.assertEqual(slot._repeat_icon.color, ("clear", 0.0))
        self.assertEqual(slot._progress_indicator.color, "cycle ring")
        self.assertEqual(slot._progress_indicator.background_color, "outline")

        # A newer active server snapshot can supersede the predicted value.
        state.client_value = Active(False)
        state.value = Active(True)
        self.assertEqual(slot._get_repeat_icon_color(), ("clear", 0.0))

        state.server_value = Idle()
        state.value = Idle()
        self.assertEqual(slot._get_repeat_icon_color(), "clear")

    def test_single_cycle_and_visual_failure_keep_native_behavior(self):
        class Active:
            repeat = False
            start_time = 10
            duration = 5

        class Slot:
            def __init__(self):
                state = NS(server_value=Active(), value=Active(), client_value=Active())
                self._slot = NS(action=NS(_module_interactor=NS(
                    _state=state,
                    _pending_reactivation_request=None,
                )))
                self.repeat_updates = 0

            def _get_repeat_icon_color(self):
                return "clear"

            def _on_repeat_changed(self, *_args):
                self.repeat_updates += 1

            def _update_repeat_icon_color(self):
                raise RuntimeError("visual unavailable")

        deactivation_adapter._evejs_install_action_bar_deactivation({
            "ActionBarSlot": Slot,
            "HudColor": NS(CONTENT_HIGHLIGHT=NS(with_alpha=lambda alpha: ("clear", alpha))),
        })
        slot = Slot()
        self.assertEqual(slot._get_repeat_icon_color(), "clear")
        slot._on_repeat_changed()
        self.assertEqual(slot.repeat_updates, 1)


class NpcCreationBridgeTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        test = self

        class Signal:
            def __init__(self):
                self.handlers = []

            def connect(self, handler):
                self.handlers.append(handler)

            def __call__(self, *args):
                for handler in self.handlers:
                    handler(*args)

        class Creation:
            @classmethod
            def from_dict(cls, value):
                return NS(item_id=value["item_id"])

        class Diagnostic:
            @classmethod
            def from_dict(cls, value):
                return NS(is_blocker=value.get("severity") == "blocker")

        class Remote:
            def __init__(self):
                self.fail_next = False

            def GetNpcCreationSnapshot(self, entity_id):
                test.events.append(("snapshot", entity_id))
                return {"item_id": entity_id}

            def CommitNpcCreationDraft(self, entity_id, changes):
                test.events.append(("commit", entity_id, changes))
                if self.fail_next:
                    self.fail_next = False
                    raise RuntimeError("trust revoked")
                return []

        self.remote = Remote()
        self.original = NS(
            on_active_creation_changed=Signal(),
            get_creation=lambda creation_id: NS(item_id=creation_id),
        )
        modules = {}
        for name in (
            "frontier", "frontier.creation", "frontier.creation.common",
            "frontier.creation.client", "frontier.creation.client.management",
        ):
            modules[name] = types.ModuleType(name)
            modules[name].__path__ = []
        model = types.ModuleType("frontier.creation.common.model")
        model.Creation = Creation
        diagnostics = types.ModuleType("frontier.creation.common.diagnostics")
        diagnostics.Diagnostic = Diagnostic
        modules[model.__name__] = model
        modules[diagnostics.__name__] = diagnostics
        self.view_state = types.ModuleType(
            "frontier.creation.client.management.view_state"
        )

        def integration(*args, **kwargs):
            return NS(service=kwargs.get("creation_service", args[0] if args else None))

        class ViewState:
            def UnloadView(self):
                test.events.append("unload")

        self.view_state.ManagementViewIntegration = integration
        self.view_state.ManagementViewState = ViewState
        modules[self.view_state.__name__] = self.view_state
        modules["frontier.creation.client.management"].view_state = self.view_state
        self.modules_patch = mock.patch.dict(sys.modules, modules)
        self.modules_patch.start()
        adapter._evejs_npc_creation_target = None

    def tearDown(self):
        adapter._evejs_npc_creation_target = None
        self.modules_patch.stop()

    def test_target_proxy_commits_to_npc_and_recovers_after_denial(self):
        proxy = adapter._EvejsNpcCreationServiceProxy(
            self.original, self.remote, 8101, {"item_id": 8101}
        )
        refreshes = []
        proxy.on_active_creation_changed.connect(refreshes.append)
        self.assertEqual(proxy.get_active_creation().item_id, 8101)
        self.remote.fail_next = True
        change = NS(to_dict=lambda: {"op": "move", "itemID": 9})
        with self.assertRaisesRegex(RuntimeError, "trust revoked"):
            proxy.commit_management_draft(100, [change])
        self.assertEqual(refreshes, [])
        self.assertEqual(proxy.commit_management_draft(100, [change]), [])
        self.assertEqual(refreshes, [8101])
        self.assertEqual(
            [entry for entry in self.events if entry[0] == "commit"],
            [("commit", 8101, [{"op": "move", "itemID": 9}])] * 2,
        )

    def test_native_view_receives_target_proxy_only_while_npc_view_is_active(self):
        self.assertTrue(adapter._evejs_install_npc_creation_view_bridge({}))
        ordinary = self.view_state.ManagementViewIntegration(
            creation_service=self.original
        )
        self.assertIs(ordinary.service, self.original)
        adapter._evejs_npc_creation_target = {
            "remote": self.remote, "entity_id": 8101,
            "snapshot": {"item_id": 8101},
        }
        target = self.view_state.ManagementViewIntegration(
            creation_service=self.original
        )
        self.assertEqual(target.service.get_active_creation().item_id, 8101)
        self.view_state.ManagementViewState().UnloadView()
        self.assertIsNone(adapter._evejs_npc_creation_target)
        self.assertIs(
            self.view_state.ManagementViewIntegration(
                creation_service=self.original
            ).service,
            self.original,
        )


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

    def test_npc_fitting_window_is_never_opened_without_server_trust(self):
        opened = []

        class Remote:
            def __init__(self):
                self.state = {"trusted": False}

            def GetNpcFittingState(self, entity_id):
                return dict(self.state, entityID=entity_id)

        remote = Remote()
        self.namespace["sm"] = NS(
            RemoteSvc=lambda name: remote,
            GetService=lambda name: NS(GetItem=lambda item_id: self.ship),
        )
        with mock.patch.object(
            adapter,
            "_evejs_open_npc_fitting_window",
            side_effect=lambda namespace, entity_id, state:
            opened.append((entity_id, state)) or "window",
        ):
            self.assertIsNone(self.Command().OpenNpcFitting(980000000001))
            self.assertEqual(opened, [])
            remote.state = {"trusted": True, "displayName": "Trusted NPC"}
            self.assertEqual(
                self.Command().OpenNpcFitting(980000000001), "window"
            )
        self.assertEqual(opened[0][0], 980000000001)
        self.assertTrue(opened[0][1]["trusted"])

    def test_trusted_legacy_npc_uses_target_specific_native_entry(self):
        entity_id = 980000000001
        state = {
            "trusted": True,
            "entityID": entity_id,
            "fittingPath": "legacy",
            "hull": {"typeID": 72207},
        }
        self.namespace["sm"] = NS(
            RemoteSvc=lambda name: NS(GetNpcFittingState=lambda target: state),
        )
        with mock.patch.object(
            adapter, "_evejs_open_npc_legacy_window", return_value="native"
        ) as native, mock.patch.object(
            adapter, "_evejs_open_npc_fitting_window"
        ) as custom:
            self.assertEqual(self.Command().OpenNpcFitting(entity_id), "native")
        native.assert_called_once_with(self.namespace, entity_id, state)
        custom.assert_not_called()

    def test_native_legacy_failure_keeps_trusted_rpc_editor_available(self):
        entity_id = 980000000001
        state = {
            "trusted": True,
            "entityID": entity_id,
            "fittingPath": "legacy",
            "hull": {"typeID": 72207},
        }
        self.namespace["sm"] = NS(
            RemoteSvc=lambda name: NS(GetNpcFittingState=lambda target: state),
        )
        fallback = NS(_presenter=NS(status=""), _status_label=NS(text=""))
        with mock.patch.object(
            adapter, "_evejs_open_npc_legacy_window",
            side_effect=RuntimeError("simulation unavailable"),
        ), mock.patch.object(
            adapter, "_evejs_open_npc_fitting_window", return_value=fallback,
        ) as custom:
            self.assertIs(self.Command().OpenNpcFitting(entity_id), fallback)
        custom.assert_called_once_with(self.namespace, entity_id, state)
        self.assertIn("simulation unavailable", fallback._status_label.text)


class NpcFittingPresenterTests(unittest.TestCase):
    def test_npc_fitting_error_uses_server_notification(self):
        error = RuntimeError("CustomInfo")
        error.dict = {"notify": "Move within 5,000 meters of that NPC"}
        self.assertEqual(
            adapter._evejs_npc_fitting_error_text(error),
            "Move within 5,000 meters of that NPC",
        )

    def test_native_legacy_window_uses_retail_open_and_binds_target(self):
        events = []

        class BaseWindow:
            @classmethod
            def Open(cls, **kwargs):
                events.append("retail-open")
                instance = cls()
                instance.ApplyAttributes(kwargs)
                return instance

            @classmethod
            def GetIfOpen(cls):
                return None

        class FittingWindow(BaseWindow):
            @classmethod
            def Open(cls, **kwargs):
                raise AssertionError("Frontier Creation override was used")

            def OpenFittingForCurrentShip(self, *args):
                raise AssertionError("player fitting manager was used")

            def ApplyAttributes(self, attributes):
                self.ConstructLayout()

            def ConstructLayout(self):
                self.overlayCont = object()
                self.fitNameParent = NS(
                    OnClick=self.OpenFittingForCurrentShip,
                    GetDragData=lambda *args: ["player fitting"],
                    isDragObject=True,
                )

        ui = types.ModuleType("eveui")
        ui.Align = NS(to_bottom="bottom", to_left="left", to_right="right")
        ui.Container = lambda **kwargs: NS(**kwargs)
        ui.EveLabelMedium = lambda **kwargs: NS(**kwargs)
        ui.Button = lambda **kwargs: events.append(("button", kwargs))
        namespace = {"FittingWindow": FittingWindow}
        target = NS(hull_type_id=72207, apply_legacy_draft=lambda *args: None)
        with mock.patch.dict(sys.modules, {"eveui": ui}):
            window_type = adapter._evejs_npc_legacy_window_type(namespace)
            window = window_type.Open(
                shipID="ship_72207", npc_target=target,
                npc_sim_ship_id="ship_72207",
            )
        self.assertIs(window._evejs_target, target)
        self.assertEqual(window._evejs_sim_ship_id, "ship_72207")
        self.assertEqual(events[0], "retail-open")
        self.assertEqual(events[1][1]["label"], "Apply to NPC")
        self.assertFalse(window.fitNameParent.isDragObject)
        self.assertEqual(window.fitNameParent.GetDragData(), [])
        self.assertIsNone(window.fitNameParent.OnClick())
        self.assertEqual(
            window._evejs_status.text,
            "Use Apply to NPC to commit this fitting",
        )

    def test_native_legacy_window_receives_npc_target_and_exact_fit(self):
        entity_id = 980000000001
        state = {
            "trusted": True, "entityID": entity_id,
            "fittingPath": "legacy", "hull": {"typeID": 72207},
            "npcCharacterID": 1500000001,
            "modules": [{
                "moduleID": 701, "typeID": 100,
                "flagID": 11, "charges": [],
            }],
            "availableModules": [], "availableCharges": [],
        }
        calls = []
        ghost = NS(
            fittingDogmaLocation=NS(GetCurrentShipID=lambda: "ship_72207"),
            LoadSimulatedFitting=lambda *args: calls.append(("load", args)),
            TakeSnapshot=lambda: NS(shipTypeID=72207),
        )
        fitting_service = NS(IsShipSimulated=lambda: False)
        namespace = {
            "FittingWindow": NS(GetIfOpen=lambda: None),
            "sm": NS(
                RemoteSvc=lambda name: object(),
                GetService=lambda name: {
                    "fittingSvc": fitting_service,
                    "ghostFittingSvc": ghost,
                }[name],
            ),
        }

        class NativeWindow:
            @classmethod
            def GetIfOpen(cls):
                return None

            @classmethod
            def Open(cls, **kwargs):
                calls.append(("open", kwargs))
                return "native-window"

        with mock.patch.object(
            adapter, "_evejs_npc_legacy_window_type", return_value=NativeWindow
        ), mock.patch.object(
            adapter, "_evejs_legacy_draft_from_snapshot",
            return_value=([(100, 11)], []),
        ):
            result = adapter._evejs_open_npc_legacy_window(
                namespace, entity_id, state
            )
        self.assertEqual(result, "native-window")
        self.assertEqual(calls[0][1][0:3], (72207, entity_id, 1500000001))
        self.assertEqual(calls[0][1][3], [(100, 11, 1)])
        self.assertEqual(calls[1][1]["shipID"], "ship_72207")
        self.assertEqual(calls[1][1]["npc_target"].entity_id, entity_id)

    def test_target_controller_applies_legacy_draft_to_npc_rpc_only(self):
        entity_id = 980000000001
        calls = []
        state = {
            "trusted": True,
            "entityID": entity_id,
            "fittingPath": "legacy",
            "hull": {"typeID": 72207},
            "modules": [],
            "availableModules": [
                {"itemID": 501, "typeID": 100, "quantity": 1},
                {"itemID": 502, "typeID": 101, "quantity": 1},
            ],
            "availableCharges": [],
        }

        class Remote:
            fail_first = True

            def GetNpcFittingState(self, target_id):
                calls.append(("read", target_id))
                return dict(state)

            def FitItem(self, target_id, item_id, flag_id):
                calls.append(("fit", target_id, item_id, flag_id))
                if self.fail_first:
                    self.fail_first = False
                    raise RuntimeError("server denied")
                state["modules"] = [{
                    "moduleID": item_id, "typeID": 101,
                    "flagID": flag_id, "charges": [],
                }]
                return dict(state)

        controller = adapter._EvejsNpcTargetController(
            Remote(), entity_id, dict(state)
        )
        with self.assertRaisesRegex(RuntimeError, "server denied"):
            controller.apply_legacy_draft([(100, 11)])
        self.assertEqual(state["modules"], [])
        controller.apply_legacy_draft([(101, 12)])
        self.assertEqual(state["modules"][0]["flagID"], 12)
        self.assertEqual(
            [call for call in calls if call[0] == "fit"],
            [("fit", entity_id, 501, 11), ("fit", entity_id, 502, 12)],
        )

    def test_target_controller_rejects_wrong_entity_and_stale_draft(self):
        entity_id = 980000000001
        state = {
            "trusted": True, "entityID": entity_id,
            "fittingPath": "legacy", "hull": {"typeID": 72207},
            "modules": [], "availableModules": [], "availableCharges": [],
        }

        class Remote:
            def GetNpcFittingState(self, target_id):
                return dict(state)

        controller = adapter._EvejsNpcTargetController(
            Remote(), entity_id, dict(state)
        )
        with self.assertRaisesRegex(RuntimeError, "target changed"):
            controller.accept(dict(state, entityID=entity_id + 1))
        state["modules"] = [{
            "moduleID": 1001, "typeID": 100,
            "flagID": 11, "charges": [],
        }]
        with self.assertRaisesRegex(RuntimeError, "changed; refresh"):
            controller.apply_legacy_draft([])

    def test_target_controller_unloads_charge_before_unfitting_module(self):
        entity_id = 980000000001
        state = {
            "trusted": True, "entityID": entity_id,
            "fittingPath": "legacy", "hull": {"typeID": 72207},
            "modules": [{
                "moduleID": 701, "typeID": 100, "flagID": 11,
                "charges": [{"cargoID": 801, "typeID": 200, "quantity": 10}],
            }],
            "availableModules": [], "availableCharges": [],
        }
        calls = []

        class Remote:
            def GetNpcFittingState(self, target_id):
                return dict(state)

            def UnloadCharge(self, target_id, cargo_id):
                calls.append(("unload", target_id, cargo_id))
                state["modules"] = [dict(state["modules"][0], charges=[])]
                return dict(state)

            def UnfitItem(self, target_id, module_id):
                calls.append(("unfit", target_id, module_id))
                state["modules"] = []
                return dict(state)

        controller = adapter._EvejsNpcTargetController(
            Remote(), entity_id, dict(state)
        )
        controller.apply_legacy_draft([])
        self.assertEqual(calls, [
            ("unload", entity_id, 801),
            ("unfit", entity_id, 701),
        ])

    def test_target_controller_checks_cargo_before_removing_current_fit(self):
        entity_id = 980000000001
        state = {
            "trusted": True, "entityID": entity_id,
            "fittingPath": "legacy", "hull": {"typeID": 72207},
            "modules": [{
                "moduleID": 701, "typeID": 100,
                "flagID": 11, "charges": [],
            }],
            "availableModules": [], "availableCharges": [],
        }
        calls = []

        class Remote:
            def GetNpcFittingState(self, target_id):
                return state

            def UnfitItem(self, target_id, module_id):
                calls.append((target_id, module_id))
                raise AssertionError("unfit must not be reached")

        controller = adapter._EvejsNpcTargetController(
            Remote(), entity_id, state
        )
        with self.assertRaisesRegex(RuntimeError, "needs 1 items"):
            controller.apply_legacy_draft([(101, 11)])
        self.assertEqual(calls, [])

    def test_window_factory_does_not_return_its_module_function(self):
        class BaseWindow:
            @classmethod
            def GetIfOpen(cls):
                return None

            @classmethod
            def Open(cls, **kwargs):
                return cls, kwargs

        scroll_module = types.ModuleType(
            "carbonui.control.scrollContainer"
        )
        scroll_module.ScrollContainer = object
        modules = {
            "eveui": types.ModuleType("eveui"),
            "carbonui": types.ModuleType("carbonui"),
            "carbonui.control": types.ModuleType("carbonui.control"),
            "carbonui.control.scrollContainer": scroll_module,
        }
        namespace = {
            "Window": BaseWindow,
            # The bytecode wrapper executes the adapter in its module globals.
            "_evejs_npc_fitting_window_type": adapter._evejs_npc_fitting_window_type,
        }
        with mock.patch.dict(sys.modules, modules):
            window_type = adapter._evejs_npc_fitting_window_type(namespace)
            self.assertTrue(issubclass(window_type, BaseWindow))
            self.assertIs(
                namespace["_evejs_npc_fitting_window_class"], window_type
            )
            self.assertIs(
                adapter._evejs_npc_fitting_window_type(namespace), window_type
            )
            opened_type, attributes = adapter._evejs_open_npc_fitting_window(
                namespace, 980000000001, {"trusted": True}
            )
        self.assertIs(opened_type, window_type)
        self.assertEqual(attributes["npc_entity_id"], 980000000001)

    def test_npc_window_resolves_builtin_service_manager_during_initialization(self):
        class BaseWindow:
            def ApplyAttributes(self, attributes):
                self.attributes = attributes

        scroll_module = types.ModuleType(
            "carbonui.control.scrollContainer"
        )
        scroll_module.ScrollContainer = object
        modules = {
            "eveui": types.ModuleType("eveui"),
            "carbonui": types.ModuleType("carbonui"),
            "carbonui.control": types.ModuleType("carbonui.control"),
            "carbonui.control.scrollContainer": scroll_module,
        }
        namespace = {"Window": BaseWindow}
        state = {"trusted": True, "entityID": 980000000001, "modules": []}
        remote = object()
        calls = []
        manager = NS(RemoteSvc=lambda name: (
            calls.append(name), remote
        )[1])
        with mock.patch.dict(sys.modules, modules):
            window_type = adapter._evejs_npc_fitting_window_type(namespace)
            with mock.patch.object(window_type, "_construct_layout"), \
                    mock.patch.object(window_type, "_render"):
                with mock.patch.object(builtins, "sm", None, create=True):
                    with self.assertRaisesRegex(
                        RuntimeError, "service manager is unavailable"
                    ):
                        window_type().ApplyAttributes(NS(
                            npc_entity_id=980000000001,
                            initial_state=state,
                        ))
                with mock.patch.object(builtins, "sm", manager, create=True):
                    window = window_type()
                    window.ApplyAttributes(NS(
                        npc_entity_id=980000000001,
                        initial_state=state,
                    ))
        self.assertIs(window._presenter.remote, remote)
        self.assertEqual(window._presenter.entity_id, 980000000001)
        self.assertEqual(calls, ["npcFittingMgr"])

    def test_npc_window_header_keeps_autosize_alignment_and_survives_button_failure(self):
        class Control:
            def __init__(self, **kwargs):
                self.parent = kwargs.get("parent")
                self.align = kwargs.get("align")
                if isinstance(self.parent, AutoSize):
                    self.parent.accept(self.align)

        class AutoSize(Control):
            def __init__(self, **kwargs):
                self.child_alignment = None
                super().__init__(**kwargs)

            def accept(self, alignment):
                if self.child_alignment is None:
                    self.child_alignment = alignment
                elif self.child_alignment != alignment:
                    raise ValueError("AutoSize children must share alignment")

        buttons = []

        def button(**kwargs):
            instance = Control(**kwargs)
            buttons.append(instance)
            return instance

        ui = types.ModuleType("eveui")
        ui.Align = NS(to_all="all", to_top="top", to_right="right")
        ui.Container = Control
        ui.ContainerAutoSize = AutoSize
        ui.EveLabelLarge = Control
        ui.EveLabelMedium = Control
        ui.Button = button
        scroll_module = types.ModuleType(
            "carbonui.control.scrollContainer"
        )
        scroll_module.ScrollContainer = Control
        modules = {
            "eveui": ui,
            "carbonui": types.ModuleType("carbonui"),
            "carbonui.control": types.ModuleType("carbonui.control"),
            "carbonui.control.scrollContainer": scroll_module,
        }

        class BaseWindow:
            def GetMainArea(self):
                return object()

        with mock.patch.dict(sys.modules, modules):
            window_type = adapter._evejs_npc_fitting_window_type(
                {"Window": BaseWindow}
            )
            window = window_type()
            window._presenter = NS(status="")
            window._construct_layout(Control, ui)
            self.assertIsInstance(window._scroll, Control)
            self.assertEqual(buttons[0].parent.align, ui.Align.to_top)
            self.assertIsInstance(buttons[0].parent.parent, AutoSize)
            self.assertEqual(
                buttons[0].parent.parent.child_alignment, ui.Align.to_top
            )

            def unavailable_button(**kwargs):
                raise RuntimeError("button unavailable")

            ui.Button = unavailable_button
            another_window = window_type()
            another_window._presenter = NS(status="")
            another_window._construct_layout(Control, ui)
            self.assertIsInstance(another_window._scroll, Control)
            self.assertIn("button unavailable", another_window._presenter.status)

    def test_presenter_replaces_state_after_each_server_authorized_mutation(self):
        calls = []

        class Remote:
            def GetNpcFittingState(self, entity_id):
                calls.append(("refresh", entity_id))
                return {"trusted": True, "modules": []}

            def FitItem(self, entity_id, item_id, flag_id):
                calls.append(("fit", entity_id, item_id, flag_id))
                return {
                    "trusted": True,
                    "modules": [{"moduleID": item_id}],
                }

            def LoadCharge(self, entity_id, module_id, item_id, quantity):
                calls.append(
                    ("load", entity_id, module_id, item_id, quantity)
                )
                return {
                    "trusted": True,
                    "modules": [{"moduleID": module_id}],
                }

        presenter = adapter._EvejsNpcFittingPresenter(
            Remote(), 980000000001, {"trusted": True, "modules": []}
        )
        presenter.fit(500)
        presenter.select_module(500)
        presenter.load(600)
        self.assertEqual(
            calls,
            [
                ("fit", 980000000001, 500, 0),
                ("load", 980000000001, 500, 600, 0),
            ],
        )
        presenter.accept({"trusted": False})
        self.assertFalse(presenter.trusted)


class NpcFittingMenuTests(unittest.TestCase):
    def test_retail_menu_startup_can_supply_missing_pilot_data(self):
        state = {"started": False}

        class MenuSvc:
            def CelestialMenu(self, itemID, *args, **kwargs):
                state["started"] = True
                return [["Board Ship", lambda: None, ()]]

        def get_service(name):
            if not state["started"]:
                raise RuntimeError("Michelle not started")
            return NS(GetBallpark=lambda: NS(
                GetCrData=lambda item_id: NS(
                    categoryID=6, charID=1500000001
                )
            ))

        namespace = {
            "MenuSvc": MenuSvc,
            "sm": NS(
                GetService=get_service,
                RemoteSvc=lambda name: NS(CanInteractNpc=lambda item_id: {
                    "canInteract": True, "canModifyFittings": False,
                }),
            ),
        }
        npc_menu_adapter._evejs_install_npc_fitting_menu(namespace)
        self.assertEqual(
            [row[0] for row in MenuSvc().CelestialMenu(980000000008)],
            ["Interact"],
        )

    def test_frontier_cr_data_drives_pilot_menu_without_slim_items(self):
        class Remote:
            def CanInteractNpc(self, entity_id):
                return {"canInteract": True, "canModifyFittings": False}

        class MenuSvc:
            def CelestialMenu(self, itemID, *args, **kwargs):
                return [["Board Ship", lambda: None, ()]]

        cr_data = {
            980000000008: NS(categoryID=6, charID=1500000001),
            980000000009: NS(categoryID=6, charID=1400000001),
            980000000010: NS(categoryID=6, charID=0),
        }
        namespace = {
            "MenuSvc": MenuSvc,
            "sm": NS(
                RemoteSvc=lambda name: Remote(),
                GetService=lambda name: NS(
                    GetCrData=lambda item_id: cr_data.get(item_id)
                ),
            ),
        }
        npc_menu_adapter._evejs_install_npc_fitting_menu(namespace)
        service = MenuSvc()
        self.assertEqual(
            [row[0] for row in service.CelestialMenu(980000000008)],
            ["Interact"],
        )
        self.assertEqual(
            [row[0] for row in service.CelestialMenu(980000000009)],
            [],
        )
        self.assertEqual(
            [row[0] for row in service.CelestialMenu(980000000010)],
            ["Board Ship"],
        )

    def test_board_ship_is_only_offered_for_an_unoccupied_hull(self):
        class Remote:
            def CanInteractNpc(self, entity_id):
                return {"canInteract": True, "canModifyFittings": False}

        class MenuSvc:
            def CelestialMenu(self, itemID, *args, **kwargs):
                return [
                    ["Board Ship", lambda: None, ()],
                    ["Show Info", lambda: None, ()],
                ]

        slim_items = {
            980000000008: NS(categoryID=6, charID=1500000001),
            980000000009: NS(categoryID=6, charID=1400000001),
            980000000010: NS(categoryID=6, charID=None),
        }
        namespace = {
            "MenuSvc": MenuSvc,
            "sm": NS(
                RemoteSvc=lambda name: Remote(),
                GetService=lambda name: NS(
                    GetBallpark=lambda: NS(slimItems=slim_items)
                ),
            ),
        }
        npc_menu_adapter._evejs_install_npc_fitting_menu(namespace)
        service = MenuSvc()
        self.assertEqual(
            [row[0] for row in service.CelestialMenu(980000000008)],
            ["Show Info", "Interact"],
        )
        self.assertEqual(
            [row[0] for row in service.CelestialMenu(980000000009)],
            ["Show Info"],
        )
        self.assertEqual(
            [row[0] for row in service.CelestialMenu(980000000010)],
            ["Board Ship", "Show Info"],
        )

    def test_high_id_asteroid_keeps_the_retail_menu(self):
        calls = []

        class MenuSvc:
            def CelestialMenu(self, itemID, *args, **kwargs):
                return [["Show Info", lambda: None, ()]]

        def remote_service(name):
            calls.append(name)
            raise RuntimeError("No NPC or assembly action")

        namespace = {
            "MenuSvc": MenuSvc,
            "sm": NS(
                RemoteSvc=remote_service,
                GetService=lambda name: NS(GetBallpark=lambda: NS(
                    slimItems={5000000000001: NS(categoryID=25)}
                )),
            ),
        }
        npc_menu_adapter._evejs_install_npc_fitting_menu(namespace)
        menu = MenuSvc().CelestialMenu(
            5000000000001, crData=NS(categoryID=25)
        )
        self.assertEqual([row[0] for row in menu], ["Show Info"])
        self.assertEqual(
            [row[0] for row in MenuSvc().CelestialMenu(5000000000001)],
            ["Show Info"],
        )
        self.assertNotIn("npcFittingMgr", calls)

    def test_piloted_npc_ship_gets_interaction_but_player_ship_does_not(self):
        class Remote:
            def CanInteractNpc(self, entity_id):
                return {"canInteract": True, "canModifyFittings": False}

        class MenuSvc:
            def CelestialMenu(self, itemID, *args, **kwargs):
                return [["Show Info", lambda: None, ()]]

        namespace = {
            "MenuSvc": MenuSvc,
            "sm": NS(
                RemoteSvc=lambda name: Remote(),
                GetService=lambda name: NS(GetBallpark=lambda: NS(
                    slimItems={
                        980000000008: NS(categoryID=6, charID=1500000001),
                    }
                )),
            ),
        }
        npc_menu_adapter._evejs_install_npc_fitting_menu(namespace)
        service = MenuSvc()
        self.assertEqual(
            [row[0] for row in service.CelestialMenu(
                980000000008,
                crData=NS(categoryID=6, charID=1500000001),
            )],
            ["Show Info", "Interact"],
        )
        self.assertEqual(
            [row[0] for row in service.CelestialMenu(980000000008)],
            ["Show Info", "Interact"],
        )
        self.assertEqual(
            [row[0] for row in service.CelestialMenu(
                980000000009,
                crData=NS(categoryID=6, charID=1400000001),
            )],
            ["Show Info"],
        )

    def test_faction_entity_has_no_player_npc_menu_or_assembly_probe(self):
        calls = []

        class Remote:
            def CanInteractNpc(self, entity_id):
                return {"canInteract": True, "canModifyFittings": False}

        class MenuSvc:
            def CelestialMenu(self, itemID, *args, **kwargs):
                return [["Show Info", lambda: None, ()]]

        def remote_service(name):
            calls.append(name)
            if name == "smartAssemblyService":
                raise AssertionError("NPC is not an assembly")
            return Remote()

        namespace = {
            "MenuSvc": MenuSvc,
            "sm": NS(RemoteSvc=remote_service),
        }
        npc_menu_adapter._evejs_install_npc_fitting_menu(namespace)
        self.assertEqual(
            [row[0] for row in MenuSvc().CelestialMenu(
                980000000004, crData=NS(categoryID=11)
            )],
            ["Show Info"],
        )
        self.assertEqual(calls, [])

    def test_retail_npc_menu_failure_keeps_interaction_action_available(self):
        class Remote:
            def CanInteractNpc(self, entity_id):
                return {"canInteract": True, "canModifyFittings": False}

        class MenuSvc:
            def CelestialMenu(self, itemID, *args, **kwargs):
                raise RuntimeError("one retail menu command failed")

        namespace = {
            "MenuSvc": MenuSvc,
            "sm": NS(RemoteSvc=lambda name: Remote()),
        }
        npc_menu_adapter._evejs_install_npc_fitting_menu(namespace)
        self.assertEqual(
            [row[0] for row in MenuSvc().CelestialMenu(
                980000000001, crData=NS(categoryID=6, charID=1500000001)
            )],
            ["Interact"],
        )
        with self.assertRaisesRegex(RuntimeError, "retail menu command"):
            MenuSvc().CelestialMenu(980000000001, crData=NS(categoryID=11))
        with self.assertRaisesRegex(RuntimeError, "retail menu command"):
            MenuSvc().CelestialMenu(123)
        with self.assertRaisesRegex(RuntimeError, "retail menu command"):
            MenuSvc().CelestialMenu(
                5000000000001, crData=NS(categoryID=25)
            )

    def test_interaction_orders_use_server_probe_and_typed_rpc(self):
        calls = []
        authorized = True

        class Remote:
            def CanInteractNpc(self, entity_id):
                return {
                    "canInteract": True,
                    "canIssueOrders": authorized,
                    "actorShipEntityID": 9988400000109,
                }

            def IssueNpcOrder(self, entity_id, order):
                calls.append((entity_id, order))
                return {"accepted": True}

        namespace = {"sm": NS(RemoteSvc=lambda name: Remote())}
        npc_menu_adapter._evejs_issue_npc_order(
            namespace, 980000000007, "keepAtRange", 900000000001, 5000
        )
        npc_menu_adapter._evejs_issue_npc_order(
            namespace, 980000000007, "lock", 900000000001
        )
        npc_menu_adapter._evejs_issue_npc_order(
            namespace, 980000000007, "resume"
        )
        npc_menu_adapter._evejs_issue_npc_order(
            namespace, 980000000007, "approach"
        )
        self.assertEqual(calls, [
            (980000000007, {"type": "keepAtRange",
                            "targetID": 900000000001, "rangeMeters": 5000}),
            (980000000007, {"type": "lock", "targetID": 900000000001}),
            (980000000007, {"type": "resume"}),
            (980000000007, {"type": "approach",
                            "targetID": 9988400000109}),
        ])
        with self.assertRaises(ValueError):
            npc_menu_adapter._evejs_issue_npc_order(
                namespace, 980000000007, "orbit", 980000000007, 2500
            )
        authorized = False
        with self.assertRaises(PermissionError):
            npc_menu_adapter._evejs_issue_npc_order(
                namespace, 980000000007, "approach", 900000000001
            )
        self.assertEqual(len(calls), 4)

    def test_right_click_interact_and_fitting_actions_are_not_in_gm_menu(self):
        trusted = False
        opened = []

        def open_npc_fitting(entity_id):
            opened.append(entity_id)
            return "fitting-window"

        class Remote:
            def CanInteractNpc(self, entity_id):
                return {
                    "canInteract": trusted,
                    "canModifyFittings": trusted,
                    "entityID": entity_id,
                }

        class MenuSvc:
            def CelestialMenu(
                self, itemID, mapItem=None, crData=None, typeID=None,
                parentID=None, hint=None
            ):
                return [["Show Info", lambda: None, ()]]

        namespace = {
            "MenuSvc": MenuSvc,
            "sm": NS(RemoteSvc=lambda name: Remote()),
            "uicore": NS(cmd=NS(
                OpenNpcFitting=open_npc_fitting
            )),
        }
        class InteractionWindow:
            @classmethod
            def GetIfOpen(cls):
                return None

            @classmethod
            def Open(cls, **kwargs):
                opened.append(kwargs)
                return "interaction-window"

        with mock.patch.object(
            npc_menu_adapter,
            "_evejs_npc_interaction_window_type",
            return_value=InteractionWindow,
        ):
            npc_menu_adapter._evejs_install_npc_fitting_menu(namespace)
            service = MenuSvc()
            self.assertEqual(
                [row[0] for row in service.CelestialMenu(
                    980000000001, crData=NS(categoryID=6, charID=1500000001)
                )],
                ["Show Info", "Interact"],
            )
            trusted = True
            menu = service.CelestialMenu(
                980000000001, crData=NS(categoryID=6, charID=1500000001)
            )
            self.assertEqual([row[0] for row in menu], [
                "Show Info", "Interact", "Modify Fittings",
            ])
            self.assertEqual(menu[-2][1](*menu[-2][2]), "interaction-window")
            menu[-1][1](*menu[-1][2])
            self.assertEqual(len(opened), 2)
            self.assertEqual(opened[0]["npc_entity_id"], 980000000001)
            self.assertEqual(opened[1], 980000000001)

            # Multi-select never performs per-NPC trust probes or adds the action.
            self.assertEqual(
                len(service.CelestialMenu([980000000001, 980000000002])),
                1,
            )

    def test_interaction_menu_rechecks_trust_before_opening(self):
        trusted = False
        opened = []

        class Remote:
            def CanInteractNpc(self, entity_id):
                return {"canInteract": trusted, "entityID": entity_id}

        namespace = {
            "sm": NS(RemoteSvc=lambda name: Remote()),
            "uicore": NS(cmd=NS(
                OpenNpcFitting=lambda entity_id: opened.append(entity_id)
            )),
        }
        class InteractionWindow:
            @classmethod
            def GetIfOpen(cls):
                return None

            @classmethod
            def Open(cls, **kwargs):
                opened.append(kwargs)
                return "interaction-window"

        # A denied probe still opens a read-only diagnostics window; it never
        # opens the fitting controls or sends an NPC order.
        with mock.patch.object(
            npc_menu_adapter,
            "_evejs_npc_interaction_window_type",
            return_value=InteractionWindow,
        ):
            self.assertEqual(npc_menu_adapter._evejs_open_npc_interaction(
                namespace, 980000000001
            ), "interaction-window")
        self.assertEqual(opened[0]["initial_probe"]["canInteract"], False)

    def test_failed_npc_probe_has_visible_diagnostic(self):
        class Remote:
            def CanInteractNpc(self, entity_id):
                raise RuntimeError("CanInteractNpc is unavailable")

        probe = npc_menu_adapter._evejs_npc_interaction_probe(
            {"sm": NS(RemoteSvc=lambda name: Remote())}, 980000000001
        )
        self.assertFalse(probe["canInteract"])
        self.assertIn(
            "CanInteractNpc is unavailable",
            npc_menu_adapter._evejs_npc_interaction_status(probe),
        )

    def test_dedicated_npc_window_opens_denied_then_retries_and_sends_order(self):
        issued = []
        authorized = False
        fitting_result = ["fitting-window"]
        fitting_opened = []
        fallback_result = ["fallback-window"]
        fallback_opened = []

        def open_npc_fitting(entity_id):
            fitting_opened.append(entity_id)
            return fitting_result[0]

        def open_fitting_fallback(module_namespace, entity_id, state):
            fallback_opened.append((entity_id, state["trusted"]))
            return fallback_result[0]

        fitting_module = types.ModuleType("eve.client.script.ui.eveCommands")
        fitting_module._evejs_open_npc_fitting_window = open_fitting_fallback

        class Control:
            def __init__(self, **kwargs):
                self.text = kwargs.get("text", "")
                self.display = True
                self.value = ""

            def SetValue(self, value):
                self.value = value

            def GetValue(self):
                return self.value

        class BaseWindow:
            opened = None

            @classmethod
            def GetIfOpen(cls):
                return cls.opened

            @classmethod
            def Open(cls, **kwargs):
                window = cls()
                window.ApplyAttributes(NS(**kwargs))
                cls.opened = window
                return window

            def ApplyAttributes(self, attributes):
                self._name = "base-window-name"

            def GetMainArea(self):
                return self

            def SetCaption(self, caption):
                self.caption = caption

        class Remote:
            def CanInteractNpc(self, entity_id):
                return {
                    "canInteract": authorized,
                    "canIssueOrders": authorized,
                    "canModifyFittings": authorized,
                    "reason": "NPC_INTERACTION_NOT_FRIENDLY",
                }

            def CanOpenNpcFitting(self, entity_id):
                return {"trusted": authorized, "entityID": entity_id}

            def GetNpcFittingState(self, entity_id):
                return {"trusted": authorized, "entityID": entity_id}

            def IssueNpcOrder(self, entity_id, order):
                issued.append((entity_id, order))
                return {"accepted": True}

        ui = types.ModuleType("eveui")
        ui.Align = NS(to_all="all", to_top="top", to_left="left")
        for name in ("Container", "ContainerAutoSize", "EveLabelLarge",
                     "EveLabelMedium", "Button"):
            setattr(ui, name, Control)
        module_names = (
            "carbonui", "carbonui.control", "carbonui.control.singlelineedits",
            "carbonui.control.singlelineedits.singleLineEditText",
        )
        modules = {name: types.ModuleType(name) for name in module_names}
        modules[module_names[-1]].SingleLineEditText = Control
        modules["eveui"] = ui
        namespace = {
            "Window": BaseWindow,
            # The real menusvc module exports this factory under its own name
            # and resolves sm from builtins, not module globals.
            "_evejs_npc_interaction_window_type": (
                npc_menu_adapter._evejs_npc_interaction_window_type
            ),
        }
        with mock.patch.dict(sys.modules, modules), mock.patch.object(
            builtins, "sm", NS(
                RemoteSvc=lambda name: Remote(),
                GetService=lambda name: NS(OpenNpcFitting=open_npc_fitting),
            ), create=True
        ), mock.patch.object(
            npc_menu_adapter.importlib, "import_module",
            return_value=fitting_module,
        ):
            window = npc_menu_adapter._evejs_open_npc_interaction(
                namespace, 980000000007
            )
            self.assertIsInstance(window, BaseWindow)
            self.assertEqual(window._name, "base-window-name")
            self.assertIn("not friendly", window._status.text)
            self.assertFalse(window._order_controls.display)
            self.assertTrue(window._retry_button.display)
            authorized = True
            window._on_retry()
            self.assertTrue(window._fit_button.display)
            self.assertTrue(window._order_controls.display)
            self.assertFalse(window._retry_button.display)
            window._on_modify_fittings()
            self.assertEqual(fitting_opened, [980000000007])
            fitting_result[0] = None
            window._on_modify_fittings()
            self.assertEqual(fallback_opened, [(980000000007, True)])
            fallback_result[0] = None
            window._on_modify_fittings()
            self.assertIn("did not open", window._status.text)
            window._target_edit.SetValue("900000000001")
            window._send_order("approach")
            self.assertEqual(window._status.text, "Order accepted: approach")
            window._target_edit.SetValue("")
            window._send_order("orbit")
            self.assertEqual(window._status.text, "Order accepted: orbit")
        self.assertEqual(issued, [
            (980000000007, {"type": "approach", "targetID": 900000000001}),
            (980000000007, {"type": "orbit", "rangeMeters": 2500}),
        ])

    def test_friendly_without_fitting_trust_only_gets_interact(self):
        class Remote:
            def CanInteractNpc(self, entity_id):
                return {
                    "canInteract": True,
                    "canModifyFittings": False,
                    "entityID": entity_id,
                }

        class MenuSvc:
            def CelestialMenu(self, itemID, *args, **kwargs):
                return [["Show Info", lambda: None, ()]]

        namespace = {
            "MenuSvc": MenuSvc,
            "sm": NS(RemoteSvc=lambda name: Remote()),
            "uicore": NS(cmd=NS()),
        }
        npc_menu_adapter._evejs_install_npc_fitting_menu(namespace)
        self.assertEqual(
            [row[0] for row in MenuSvc().CelestialMenu(
                980000000001, crData=NS(categoryID=6, charID=1500000001)
            )],
            ["Show Info", "Interact"],
        )

    def test_assembly_access_action_requires_a_valid_assembly_probe(self):
        opened = []
        probes = []

        class Remote:
            def CanOpenNpcFitting(self, entity_id):
                return {"trusted": False, "entityID": entity_id}

            def CanInteractNpc(self, entity_id):
                return {"canInteract": False, "entityID": entity_id}

            def get_assembly_access(self, item_id, capabilities):
                probes.append(item_id)
                if item_id != 7001:
                    raise RuntimeError("not an assembly")
                return {
                    "assemblyID": item_id,
                    "capabilities": capabilities,
                }

        class MenuSvc:
            def CelestialMenu(
                self, itemID, mapItem=None, crData=None, typeID=None,
                parentID=None, hint=None
            ):
                return [["Show Info", lambda: None, ()]]

        namespace = {
            "MenuSvc": MenuSvc,
            "sm": NS(RemoteSvc=lambda name: Remote()),
            "uicore": NS(cmd=NS()),
        }
        component = types.ModuleType("spacecomponents.common.componentConst")
        component.SMART_DEPLOYABLE = "smartDeployable"
        data = types.ModuleType("spacecomponents.common.data")
        data.type_has_space_component = (
            lambda type_id, name: type_id == 1001 and
            name == component.SMART_DEPLOYABLE
        )
        with mock.patch.object(
            npc_menu_adapter,
            "_evejs_open_assembly_access",
            side_effect=lambda ns, item_id: opened.append(item_id),
        ), mock.patch.dict(sys.modules, {
            "spacecomponents": types.ModuleType("spacecomponents"),
            "spacecomponents.common": types.ModuleType("spacecomponents.common"),
            "spacecomponents.common.componentConst": component,
            "spacecomponents.common.data": data,
        }):
            npc_menu_adapter._evejs_install_npc_fitting_menu(namespace)
            self.assertEqual(len(MenuSvc().CelestialMenu(
                8001, crData=NS(typeID=1001)
            )), 1)
            menu = MenuSvc().CelestialMenu(7001, crData=NS(typeID=1001))
            self.assertEqual(menu[-1][0], "Manage Assembly Access")
            menu[-1][1](*menu[-1][2])
            for _ in range(3):
                self.assertEqual(
                    [row[0] for row in MenuSvc().CelestialMenu(
                        30000004, mapItem=NS(typeID=5),
                    )],
                    ["Show Info"],
                )
        self.assertEqual(opened, [7001])
        self.assertEqual(probes, [8001, 7001])


class NpcPrimaryActionTests(unittest.TestCase):
    def test_frontier_cr_data_hides_hud_boarding_without_slim_items(self):
        class Resolver:
            def __init__(self):
                self._michelle = NS(GetCrData=lambda item_id: NS(
                    categoryID=6, charID=1500000001
                ))

            def resolve(self, bracket_key):
                return NS(
                    primary=NS(label_path="UI/Inflight/BoardShip"),
                    secondary=NS(label_path="UI/Inflight/UnlockTarget"),
                )

        namespace = {"ActionResolver": Resolver}
        npc_primary_adapter._evejs_install_npc_primary_action(namespace)
        action = Resolver().resolve(NS(ball_id=980000000008))
        self.assertEqual(action.primary.label_path, "UI/Inflight/UnlockTarget")
        self.assertIsNone(action.secondary)

    def test_unavailable_ballpark_preserves_retail_action(self):
        action = NS(primary=NS(label_path="UI/Inflight/BoardShip"), secondary=None)

        class Resolver:
            def resolve(self, bracket_key):
                return action

        namespace = {
            "ActionResolver": Resolver,
            "sm": NS(GetService=lambda name: (_ for _ in ()).throw(
                RuntimeError("ballpark unavailable")
            )),
        }
        npc_primary_adapter._evejs_install_npc_primary_action(namespace)
        self.assertIs(Resolver().resolve(NS(ball_id=980000000008)), action)

    def test_boarding_is_removed_when_it_is_the_secondary_action(self):
        class Resolver:
            def resolve(self, bracket_key):
                return NS(
                    primary=NS(label_path="UI/Inflight/UnlockTarget"),
                    secondary=NS(label_path="UI/Inflight/BoardShip"),
                )

        namespace = {
            "ActionResolver": Resolver,
            "sm": NS(GetService=lambda name: NS(
                GetBallpark=lambda: NS(slimItems={
                    980000000008: NS(categoryID=6, charID=1500000001),
                })
            )),
        }
        npc_primary_adapter._evejs_install_npc_primary_action(namespace)
        action = Resolver().resolve(NS(ball_id=980000000008))
        self.assertEqual(action.primary.label_path, "UI/Inflight/UnlockTarget")
        self.assertIsNone(action.secondary)

    def test_occupied_ship_hides_boarding_without_replacing_it_with_interact(self):
        class BallKey:
            def __init__(self, ball_id):
                self.ball_id = ball_id

        class Resolver:
            def resolve(self, bracket_key):
                return NS(
                    primary=NS(label_path="UI/Inflight/BoardShip"),
                    secondary=NS(label_path="UI/Inflight/UnlockTarget"),
                )

        slim_items = {
            980000000008: NS(categoryID=6, charID=1500000001),
            980000000009: NS(categoryID=6, charID=1400000001),
            980000000010: NS(categoryID=6, charID=None),
        }
        namespace = {
            "ActionResolver": Resolver,
            "sm": NS(GetService=lambda name: NS(
                GetBallpark=lambda: NS(slimItems=slim_items)
            )),
        }
        original = Resolver.resolve
        npc_primary_adapter._evejs_install_npc_primary_action(namespace)
        npc_primary_adapter._evejs_install_npc_primary_action(namespace)
        self.assertIsNot(Resolver.resolve, original)
        for ship_id in (980000000008, 980000000009):
            action = Resolver().resolve(BallKey(ship_id))
            self.assertEqual(action.primary.label_path, "UI/Inflight/UnlockTarget")
            self.assertIsNone(action.secondary)
        action = Resolver().resolve(BallKey(980000000010))
        self.assertEqual(action.primary.label_path, "UI/Inflight/BoardShip")
        self.assertEqual(action.secondary.label_path, "UI/Inflight/UnlockTarget")


class AssemblyAccessPresenterTests(unittest.TestCase):
    def test_failed_request_list_does_not_hide_grants(self):
        class Remote:
            def get_assembly_access(self, item_id, capabilities):
                return {"policyRevision": 2}

            def get_assembly_access_requests(self, item_id, options):
                raise RuntimeError("requests unavailable")

            def get_assembly_access_grants(self, item_id, options):
                return [{"grantID": "still-visible"}]

            def get_assembly_access_events(self, item_id, options):
                return {"events": []}

            def get_npc_load_shedding_requests(self, item_id):
                return []

        presenter = npc_menu_adapter._EvejsAssemblyAccessPresenter(
            {}, 42, remote=Remote()
        )
        presenter.refresh()
        self.assertEqual(presenter.requests, [])
        self.assertEqual(presenter.grants[0]["grantID"], "still-visible")

    def test_full_player_access_workflow_stays_server_authoritative(self):
        calls = []

        class Remote:
            def get_assembly_access(self, item_id, capabilities):
                calls.append(("resolve", item_id, capabilities))
                return {
                    "assemblyID": item_id,
                    "principal": "entity:player:42",
                    "isOwner": True,
                    "capabilities": ["gui.view", "manage_access"],
                    "policyRevision": 7,
                }

            def get_assembly_access_requests(self, item_id, options):
                return [{
                    "requestID": "request-one",
                    "requesterPrincipal": "entity:player:43",
                    "status": "requested",
                    "capabilities": ["gui.view"],
                }]

            def get_assembly_access_grants(self, item_id, options):
                return [{
                    "grantID": "grant-one",
                    "recipientPrincipal": "tribe:99",
                    "capabilities": ["gui.view"],
                    "authority": "sui_confirmed",
                }]

            def get_assembly_access_events(self, item_id, options):
                return {"events": [{"sequence": 1}]}

            def get_npc_load_shedding_requests(self, item_id):
                return [{
                    "job_id": "shed-one",
                    "proposed_plan": {
                        "selected": [{"assemblyID": 8001}],
                    },
                }]

            def request_assembly_access(self, *args):
                calls.append(("request",) + args)
                return {"requestID": args[2]["requestID"]}

            def cancel_assembly_access_request(self, *args):
                calls.append(("cancel",) + args)
                return {"status": "cancelled"}

            def approve_assembly_access(self, *args):
                calls.append(("approve",) + args)
                return {"status": "approved"}

            def deny_assembly_access(self, *args):
                calls.append(("deny",) + args)
                return {"status": "denied"}

            def share_assembly_access(self, *args):
                calls.append(("share",) + args)
                return {"grantID": "grant-two"}

            def revoke_assembly_access(self, *args):
                calls.append(("revoke",) + args)
                return {"status": "revoked"}

            def open_shared_assembly_gui(self, *args):
                calls.append(("open",) + args)
                return {"token": "opaque-token"}

            def validate_shared_assembly_gui(self, *args):
                calls.append(("validate",) + args)
                return {"valid": True}

            def approve_npc_load_shedding(self, *args):
                calls.append(("shed",) + args)
                return {"jobID": args[0], "approved": True}

        interactions = []
        namespace = {
            "sm": NS(GetService=lambda name: NS(
                on_interaction=lambda item_id: interactions.append(item_id)
            )),
        }
        presenter = npc_menu_adapter._EvejsAssemblyAccessPresenter(
            namespace, 7001, Remote()
        )
        presenter.refresh()
        self.assertTrue(presenter.is_owner)
        self.assertTrue(presenter.can_manage)
        self.assertEqual(len(presenter.requests), 1)
        self.assertEqual(len(presenter.grants), 1)
        self.assertEqual(len(presenter.load_shedding), 1)

        with mock.patch.object(
            npc_menu_adapter.uuid,
            "uuid4",
            side_effect=["request-id", "share-id"],
        ):
            presenter.request_access("gui.view, operate", 3600000)
            presenter.share_access("tribe:99", ["gui.view"], 7200000)
        presenter.approve_request("request-one")
        presenter.deny_request("request-one")
        presenter.cancel_request("request-one")
        presenter.revoke_grant("grant-one")
        presenter.approve_load_shedding(
            "shed-one", [8001], "Preserve navigation headroom"
        )
        self.assertEqual(
            presenter.open_shared_gui(), {"token": "opaque-token"}
        )

        operations = [entry[0] for entry in calls]
        for operation in (
            "request", "share", "approve", "deny", "cancel", "revoke", "shed", "open",
            "validate",
        ):
            self.assertIn(operation, operations)
        request = next(entry for entry in calls if entry[0] == "request")
        self.assertEqual(request[3]["idempotencyKey"], "request-id")
        share = next(entry for entry in calls if entry[0] == "share")
        self.assertEqual(share[2], "tribe:99")
        self.assertEqual(share[4]["idempotencyKey"], "share-id")
        validation = next(entry for entry in calls if entry[0] == "validate")
        self.assertEqual(validation[1:], (7001, "opaque-token", "gui.view"))
        self.assertEqual(interactions, [7001])


class CreationServiceAdapterTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.ship = NS(typeID=87698)
        test = self

        class Signal:
            def __init__(self):
                self.handlers = []

            def connect(self, handler):
                self.handlers.append(handler)

            def __call__(self, *args):
                for handler in self.handlers:
                    handler(*args)

        class Remote:
            def list_presets(self):
                test.events.append(("preset-rpc", "list"))
                return [{"presetID": "one"}]

            def save_preset(self, creation_id, name, description):
                test.events.append(
                    ("preset-rpc", "save", creation_id, name, description)
                )
                return {"success": True, "data": {"presetID": "one"}}

            def rename_preset(self, preset_id, name, description):
                test.events.append(
                    ("preset-rpc", "rename", preset_id, name, description)
                )
                return {"success": True, "data": {"presetID": preset_id}}

            def delete_preset(self, preset_id):
                test.events.append(("preset-rpc", "delete", preset_id))
                return {"success": True, "data": {"presetID": preset_id}}

            def preview_preset(self, creation_id, preset_id):
                test.events.append(
                    ("preset-rpc", "preview", creation_id, preset_id)
                )
                return {
                    "success": True,
                    "data": {"previewToken": "token"},
                }

            def apply_preset(self, creation_id, preset_id, token):
                test.events.append(
                    ("preset-rpc", "apply", creation_id, preset_id, token)
                )
                return {"success": True, "data": {}}

        class CreationService:
            def __init__(self):
                self._active_creation = "stale"
                self._remote = Remote()

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
            "signals": NS(Signal=Signal),
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

    def test_preset_rpcs_are_exposed_and_mutations_emit_refresh_signal(self):
        service = self.CreationService()
        changes = []
        service.on_creation_presets_changed.connect(
            lambda action, result: changes.append(action)
        )
        self.assertEqual(service.list_creation_presets(), [{"presetID": "one"}])
        saved = service.save_creation_preset(100, "Baseline", "desc")
        service.rename_creation_preset("one", "Renamed", "updated")
        service.preview_creation_preset(100, "one")
        service.apply_creation_preset(100, "one", "token")
        service.delete_creation_preset("one")
        self.assertTrue(saved["success"])
        self.assertEqual(changes, ["save", "rename", "apply", "delete"])
        self.assertEqual(
            [entry[1] for entry in self.events if entry[0] == "preset-rpc"],
            ["list", "save", "rename", "preview", "apply", "delete"],
        )


class ActionBarAdapterTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.active_effect = None
        self.base_duration = None
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
                if type_id == 600:
                    return NS(effectName="useMissiles")
                if type_id == 95319:
                    return NS(effectName="modulebonusLeap")
                if type_id == 95810:
                    return NS(effectName="modulebonusThrustOverdrive")
                return None

            def GetEffect(self, item_id, effect_name):
                return test.active_effect

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

            def _get_duration(self, module_item_id, type_id):
                return test.base_duration

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

    def test_bad_module_does_not_hide_other_action_bar_modules(self):
        class BadModule:
            itemID = 999

            @property
            def typeID(self):
                raise RuntimeError("module data unavailable")

        self.ship.modules.insert(1, BadModule())
        modules = self.Provider().get_activatable_modules(100)
        self.assertEqual([module.item_id for module in modules], [500, 501, 502])

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

    def test_active_creation_effect_uses_authoritative_cycle_duration(self):
        self.ship.typeID = 95276
        self.module.typeID = 95319  # Leap has no durationAttributeID.
        self.active_effect = NS(isActive=True, duration=7000)
        provider = self.Provider()
        self.assertEqual(provider._get_duration(500, 95319), timedelta(seconds=7))

        self.module.typeID = 95810  # Thrust Overdrive is also attribute-less.
        self.base_duration = timedelta(seconds=1)
        self.active_effect = NS(isActive=True, duration=2500)
        self.assertEqual(
            provider._get_duration(500, 95810),
            timedelta(milliseconds=2500),
        )

    def test_inactive_or_invalid_effect_keeps_original_duration(self):
        provider = self.Provider()
        self.base_duration = timedelta(seconds=3)
        for effect in (
            None,
            NS(isActive=False, duration=7000),
            NS(isActive=True, duration=-1),
            NS(isActive=True, duration="invalid"),
        ):
            self.active_effect = effect
            self.assertEqual(provider._get_duration(500, 600), self.base_duration)

    def test_action_bar_patch_is_idempotent(self):
        first = self.Provider.get_activatable_modules
        first_duration = self.Provider._get_duration
        action_bar_adapter._evejs_install_action_bar_compatibility(
            self.namespace
        )
        self.assertIs(self.Provider.get_activatable_modules, first)
        self.assertIs(self.Provider._get_duration, first_duration)


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

    def test_failed_module_menu_still_shows_consumables(self):
        class BrokenIntegration(self.Integration):
            def _add_available_module_entries(self, menu, slot_index):
                raise RuntimeError("module menu failed")

        namespace = dict(self.namespace, ActionBarIntegration=BrokenIntegration)
        selection_adapter._evejs_install_action_bar_selection(namespace)
        menu = self._menu()
        BrokenIntegration(100)._add_available_module_entries(menu, 1)
        self.assertEqual(menu.captions, ["Add consumable"])
        self.assertEqual([entry["text"] for entry in menu.entries], ["Nanite"])


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
                "creationTransform": "patched",
                "turretTracking": "patched",
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

    def test_npc_fitting_menu_wrapper_is_exact_and_idempotent(self):
        code = compile(
            "class MenuSvc:\n"
            "    def CelestialMenu(self, itemID, mapItem=None, crData=None, "
            "typeID=None, parentID=None, hint=None): return []\n",
            "menu_fixture.py",
            "exec",
        )
        source = member_for(code)
        expected = hashlib.sha256(source).hexdigest()
        patched = patcher.patched_menu_member(source)
        self.assertEqual(
            patcher.inspect_member(
                source, expected, patcher.patched_menu_member, set()
            )[0],
            "source",
        )
        self.assertEqual(
            patcher.inspect_member(
                patched, expected, patcher.patched_menu_member, set()
            )[0],
            "patched",
        )

    def test_npc_primary_action_wrapper_is_exact_and_idempotent(self):
        code = compile(
            "class ActionResolver:\n"
            "    def resolve(self, bracket_key): return None\n",
            "primary_action_fixture.py",
            "exec",
        )
        source = member_for(code)
        expected = hashlib.sha256(source).hexdigest()
        patched = patcher.patched_primary_action_member(source)
        self.assertEqual(
            patcher.inspect_member(
                source, expected, patcher.patched_primary_action_member, set()
            )[0],
            "source",
        )
        self.assertEqual(
            patcher.inspect_member(
                patched, expected, patcher.patched_primary_action_member,
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

    def test_action_bar_slot_wrapper_is_exact_and_idempotent(self):
        code = compile(
            "class ActionBarSlot:\n"
            "    def _get_repeat_icon_color(self): return None\n"
            "    def _on_repeat_changed(self): pass\n",
            "action_bar_slot_fixture.py",
            "exec",
        )
        source = member_for(code)
        expected = hashlib.sha256(source).hexdigest()
        patched = patcher.patched_action_bar_slot_member(source)
        self.assertEqual(
            patcher.inspect_member(
                source, expected, patcher.patched_action_bar_slot_member, set()
            )[0],
            "source",
        )
        self.assertEqual(
            patcher.inspect_member(
                patched, expected, patcher.patched_action_bar_slot_member, set()
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
                        patcher.MENU_MODULE_NAME,
                        patcher.PRIMARY_ACTION_MODULE_NAME,
                        patcher.CREATION_SERVICE_MODULE_NAME,
                        patcher.ACTION_PROVIDER_MODULE_NAME,
                        patcher.ACTION_BAR_INTEGRATION_MODULE_NAME,
                        patcher.ACTION_BAR_SLOT_MODULE_NAME,
                        patcher.SKILLSHOT_CONTROLLER_MODULE_NAME,
                        patcher.SKILLSHOT_AUTO_CANNON_MODULE_NAME,
                    )
                }
            with zipfile.ZipFile(archive_path, "w") as archive:
                for name, member in members.items():
                    archive.writestr(name, member)
                archive.writestr("unrelated.pyc", b"preserve exactly")

            self.assertIn(
                patcher.inspect_archive(archive_path)[0],
                {"source", "outdated", "patched"},
            )
            patcher.patch_archive(archive_path)
            once = archive_path.read_bytes()
            self.assertEqual(patcher.inspect_archive(archive_path)[0], "patched")
            patcher.patch_archive(archive_path)
            self.assertEqual(archive_path.read_bytes(), once)
            with zipfile.ZipFile(archive_path) as result:
                self.assertEqual(result.read("unrelated.pyc"), b"preserve exactly")


if __name__ == "__main__":
    unittest.main()
