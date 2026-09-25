"""Regression coverage for build-3502403 Creation skill-shot authority."""

from pathlib import Path
import sys
import types
import unittest


CLIENT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CLIENT_DIR))

import skillshot_authority_auto_cannon_adapter as auto_adapter  # noqa: E402
import skillshot_authority_controller_adapter as controller_adapter  # noqa: E402
import skillshot_held_beam_charge_adapter as held_beam_adapter  # noqa: E402


class ControllerAdapterTests(unittest.TestCase):
    def setUp(self):
        class SkillShotController:
            def __init__(self):
                self._fire_in_progress = False
                self.sessions = []
                self.remote_service_names = []
                self.begin_fire_calls = []

                def remote_service(name):
                    self.remote_service_names.append(name)
                    return types.SimpleNamespace(
                        BeginFire=self.begin_fire_calls.append,
                    )

                self._service_manager = types.SimpleNamespace(
                    RemoteSvc=remote_service,
                )

            def fire(self):
                if self._fire_in_progress:
                    return None
                self._fire_in_progress = True
                return self._fire_session()

            def _fire_session(self):
                try:
                    states = self._build_turret_states([701], (1.0, 0.0, 0.0))
                    self.sessions.append(states)
                    self._service_manager.RemoteSvc("skillShot").BeginFire(states)
                    return states
                finally:
                    self._fire_in_progress = False

            @staticmethod
            def _build_turret_states(module_item_ids, aim_direction):
                return [(module_id, aim_direction) for module_id in module_item_ids]

        self.controller_type = SkillShotController
        controller_adapter._evejs_install_skillshot_authority({
            "SkillShotController": SkillShotController,
        })

    def test_only_explicit_automatic_sessions_carry_the_contract_marker(self):
        controller = self.controller_type()

        controller.fire()
        controller.fire_automatic()
        controller.fire()

        self.assertEqual(len(controller.sessions[0][0]), 2)
        self.assertEqual(
            controller.sessions[1][0][2],
            controller_adapter.AUTO_FIRE_CONTRACT_MARKER,
        )
        self.assertEqual(len(controller.sessions[2][0]), 2)
        self.assertEqual(
            controller.remote_service_names,
            ["skillShot", "skillShot", "skillShot"],
        )
        self.assertEqual(controller.begin_fire_calls, controller.sessions)
        self.assertNotIn("_build_turret_states", controller.__dict__)

    def test_suppressed_auto_poll_does_not_mark_a_later_manual_session(self):
        controller = self.controller_type()
        controller._fire_in_progress = True
        controller.fire_automatic()
        controller._fire_in_progress = False

        controller.fire()

        self.assertEqual(len(controller.sessions[0][0]), 2)

    def test_install_is_idempotent(self):
        first_session = self.controller_type._fire_session
        first_automatic = self.controller_type.fire_automatic
        controller_adapter._evejs_install_skillshot_authority({
            "SkillShotController": self.controller_type,
        })
        self.assertIs(self.controller_type._fire_session, first_session)
        self.assertIs(self.controller_type.fire_automatic, first_automatic)


class AutoCannonAdapterTests(unittest.TestCase):
    def setUp(self):
        self.original_failures = []
        test_case = self

        class AutoCannonMode:
            def OnSkillShotFailed(self, error_key, error_args):
                test_case.original_failures.append((error_key, error_args))

            def _stop_toggle_fire(self):
                self.stop_calls += 1
                self._toggle_fire_active = False

        self.auto_cannon_type = AutoCannonMode
        self.sleep_calls = []

        def sleep_sim(interval):
            self.sleep_calls.append(interval)
            self.mode._toggle_fire_active = False

        auto_adapter._evejs_install_skillshot_auto_fire_authority({
            "AutoCannonMode": AutoCannonMode,
            "uthread2": types.SimpleNamespace(sleep_sim=sleep_sim),
            "_AUTO_FIRE_POLL_INTERVAL": 0.5,
        })

    def test_toggle_loop_uses_explicit_automatic_fire_contract(self):
        calls = []
        self.mode = self.auto_cannon_type()
        self.mode._toggle_fire_active = True
        self.mode._auto_fire_tasklet = object()
        self.mode._firing_controller = types.SimpleNamespace(
            fire=lambda: calls.append("manual"),
            fire_automatic=lambda: calls.append("automatic"),
        )

        self.mode._auto_fire_loop()

        self.assertEqual(calls, ["automatic"])
        self.assertEqual(self.sleep_calls, [0.5])

    def test_repeater_rejection_stops_toggle_without_generic_popup_path(self):
        audio = []
        reticle = []
        self.mode = self.auto_cannon_type()
        self.mode._toggle_fire_active = True
        self.mode.stop_calls = 0
        self.mode._audio_service = types.SimpleNamespace(
            SendUIEvent=audio.append,
        )
        self.mode._reticle_controller = types.SimpleNamespace(
            flash_fire_error=lambda title, detail: reticle.append((title, detail)),
        )

        self.mode.OnSkillShotFailed(
            auto_adapter.AUTO_FIRE_CONTROLLER_OFFLINE,
            {},
        )

        self.assertEqual(self.mode.stop_calls, 1)
        self.assertFalse(self.mode._toggle_fire_active)
        self.assertEqual(audio, ["skillshot_trigger_failed"])
        self.assertEqual(reticle, [("FIRE FAILED", "REPEATER OFFLINE")])
        self.assertEqual(self.original_failures, [])

    def test_terminal_automatic_failure_stops_toggle_without_popup_spam(self):
        audio = []
        reticle = []
        self.mode = self.auto_cannon_type()
        self.mode._toggle_fire_active = True
        self.mode.stop_calls = 0
        self.mode._audio_service = types.SimpleNamespace(
            SendUIEvent=audio.append,
        )
        self.mode._reticle_controller = types.SimpleNamespace(
            flash_fire_error=lambda title, detail: reticle.append((title, detail)),
        )

        self.mode.OnSkillShotFailed(
            auto_adapter.AUTO_FIRE_TERMINATED,
            {},
        )

        self.assertEqual(self.mode.stop_calls, 1)
        self.assertFalse(self.mode._toggle_fire_active)
        self.assertEqual(audio, ["skillshot_trigger_failed"])
        self.assertEqual(reticle, [("FIRE FAILED", "AUTO-FIRE STOPPED")])
        self.assertEqual(self.original_failures, [])

    def test_other_failures_keep_the_retail_handler(self):
        self.mode = self.auto_cannon_type()
        self.mode.OnSkillShotFailed("NoCharges", {"module": 701})
        self.assertEqual(
            self.original_failures,
            [("NoCharges", {"module": 701})],
        )


class HeldBeamChargeAuthorityTests(unittest.TestCase):
    def test_stale_local_charge_cache_does_not_suppress_server_fire(self):
        calls = []

        class HeldBeamFireUnit:
            def _has_loaded_charge(self):
                return False

            def begin_firing(self):
                if self._has_loaded_charge():
                    calls.append("BeginHeldBeam")

        held_beam_adapter._evejs_install_held_beam_charge_authority({
            "HeldBeamFireUnit": HeldBeamFireUnit,
        })
        patched = HeldBeamFireUnit._has_loaded_charge
        held_beam_adapter._evejs_install_held_beam_charge_authority({
            "HeldBeamFireUnit": HeldBeamFireUnit,
        })
        self.assertIs(HeldBeamFireUnit._has_loaded_charge, patched)
        HeldBeamFireUnit().begin_firing()
        self.assertEqual(calls, ["BeginHeldBeam"])


if __name__ == "__main__":
    unittest.main()
