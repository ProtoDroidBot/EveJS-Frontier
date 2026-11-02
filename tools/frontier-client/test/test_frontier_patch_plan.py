"""Exact build selection and portable code.ccp adapter dispatch."""

from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import frontier_windows_client as core
import patch_frontier_docking as docking
import patch_frontier_features as features


ARCHIVE = Path("unused-copy.ccp")
BASE_CHECKS = [core.DOCKING_PATCHER, core.FEATURE_PATCHER]
CHECK_350 = [*BASE_CHECKS, core.INDUSTRY_STORAGE_PATCHER, core.MAP_VIEW_PATCHER,
             core.FITTING_COMPATIBILITY_PATCHER, core.INVENTORY_VIEW_PATCHER,
             core.COLLISION_VFX_PATCHER, core.ASTEROID_VISUAL_SCALE_PATCHER,
             core.CREATION_TRANSFORM_PATCHER, core.DUNGEON_PROP_HOLOGRAM_PATCHER,
             core.PHYSICS_GUN_PATCHER, core.TURRET_TRACKING_PATCHER]
WRITE_350 = [*BASE_CHECKS, core.INDUSTRY_STORAGE_PATCHER, core.MAP_VIEW_PATCHER,
             core.FITTING_COMPATIBILITY_PATCHER, core.TURRET_TRACKING_PATCHER,
             core.INVENTORY_VIEW_PATCHER, core.COLLISION_VFX_PATCHER,
             core.ASTEROID_VISUAL_SCALE_PATCHER, core.CREATION_TRANSFORM_PATCHER,
             core.DUNGEON_PROP_HOLOGRAM_PATCHER, core.PHYSICS_GUN_PATCHER]
KEYS_350 = ["docking", "features", "industryStorage", "mapViewLifecycle", "fittingCompatibility",
            "inventoryView", "collisionVfx", "asteroidVisualScale", "creationTransform",
            "dungeonPropHologram", "physicsGun", "turretTracking"]
SCRIPT_KEYS = dict(zip(CHECK_350, KEYS_350))


class PatchPlanTests(unittest.TestCase):
    def dispatch(self, states, writes, *, update=True):
        def run(script, archive, build, check):
            self.assertEqual(archive, ARCHIVE)
            key = SCRIPT_KEYS[script]
            if check:
                return states[key]
            writes.append(script)
            if update:
                states[key] = "patched"
            return "patched"
        return run

    def test_registered_plans_have_exact_docking_and_feature_profiles(self):
        self.assertEqual(set(core.CODE_PATCH_PLANS), {2703993, 3467658, 3474408, 3488090, 3502403, 3640684})
        self.assertEqual(set(core.CODE_PATCH_PLANS), set(docking.BUILD_PROFILES) & set(features.BUILD_PROFILES))

    def test_registered_modern_base_builds_select_only_their_two_adapters(self):
        for build in [3467658, 3474408, 3488090, 3640684]:
            with self.subTest(build=build):
                states, writes = {"docking": "source", "features": "source"}, []
                with mock.patch.object(core, "run_python_patcher", side_effect=self.dispatch(states, writes)) as run:
                    self.assertEqual(core.patch_code_archive(ARCHIVE, build), {"docking": "patched", "features": "patched"})
                self.assertEqual(writes, BASE_CHECKS)
                checks = [call.args[0] for call in run.call_args_list if call.kwargs["check"]]
                self.assertEqual(checks, BASE_CHECKS + BASE_CHECKS)
                self.assertTrue(all(call.args[2] == build for call in run.call_args_list))

    def test_3502403_preserves_every_adapter_and_distinct_check_and_write_orders(self):
        states, writes = dict.fromkeys(KEYS_350, "source"), []
        with mock.patch.object(core, "run_python_patcher", side_effect=self.dispatch(states, writes)) as run:
            actual = core.patch_code_archive(ARCHIVE, 3502403)
        self.assertEqual(actual, dict.fromkeys(KEYS_350, "patched"))
        self.assertEqual(list(actual), KEYS_350)
        self.assertEqual(core.expected_code_states(3502403, "source"), dict.fromkeys(KEYS_350, "source"))
        self.assertEqual(writes, WRITE_350)
        self.assertEqual([call.args[0] for call in run.call_args_list if call.kwargs["check"]], CHECK_350 + CHECK_350)

    def test_exact_2703993_keeps_native_docking_and_runs_only_its_feature_writer(self):
        states, writes = {"docking": "native", "features": "source"}, []
        with mock.patch.object(core, "run_python_patcher", side_effect=self.dispatch(states, writes)) as run:
            self.assertEqual(core.patch_code_archive(ARCHIVE, 2703993), {"docking": "native", "features": "patched"})
        self.assertEqual(writes, [core.FEATURE_PATCHER])
        self.assertEqual([call.args[0] for call in run.call_args_list if call.kwargs["check"]], BASE_CHECKS + BASE_CHECKS)
        for state in ["source", "patched"]:
            self.assertEqual(core.expected_code_states(2703993, state), {"docking": "native", "features": state})

    def test_all_registered_plans_are_idempotent_when_fully_prepared(self):
        for build in core.CODE_PATCH_PLANS:
            with self.subTest(build=build):
                states, writes = core.expected_code_states(build, "patched"), []
                with mock.patch.object(core, "run_python_patcher", side_effect=self.dispatch(states, writes)):
                    self.assertEqual(core.patch_code_archive(ARCHIVE, build), states)
                self.assertEqual(writes, [])

    def test_partial_feature_industry_and_inventory_states_refuse_all_writers(self):
        for key, message in [("features", "partial Frontier feature"),
                             ("industryStorage", "partial Industry storage"),
                             ("inventoryView", "partial inventory-view")]:
            with self.subTest(key=key):
                states, writes = dict.fromkeys(KEYS_350, "source"), []
                states[key] = "partial"
                with mock.patch.object(core, "run_python_patcher", side_effect=self.dispatch(states, writes)):
                    with self.assertRaisesRegex(core.FrontierWindowsError, message):
                        core.patch_code_archive(ARCHIVE, 3502403)
                self.assertEqual(writes, [])

    def test_phase4_partial_feature_state_refuses_mutation(self):
        states, writes = {"docking": "native", "features": "partial"}, []
        with mock.patch.object(core, "run_python_patcher", side_effect=self.dispatch(states, writes)):
            with self.assertRaisesRegex(core.FrontierWindowsError, "partial Frontier feature"):
                core.patch_code_archive(ARCHIVE, 2703993)
        self.assertEqual(writes, [])

    def test_outdated_is_repairable_only_for_declared_adapters(self):
        repairable = set(KEYS_350) - {"docking", "features", "mapViewLifecycle"}
        states, writes = dict.fromkeys(KEYS_350, "patched"), []
        states.update(dict.fromkeys(repairable, "outdated"))
        with mock.patch.object(core, "run_python_patcher", side_effect=self.dispatch(states, writes)):
            self.assertEqual(core.patch_code_archive(ARCHIVE, 3502403), dict.fromkeys(KEYS_350, "patched"))
        self.assertEqual(writes, [script for script in WRITE_350 if SCRIPT_KEYS[script] in repairable])
        for key in ["docking", "features", "mapViewLifecycle"]:
            with self.subTest(key=key):
                states, writes = dict.fromkeys(KEYS_350, "patched"), []
                states[key] = "outdated"
                with mock.patch.object(core, "run_python_patcher", side_effect=self.dispatch(states, writes)):
                    with self.assertRaisesRegex(core.FrontierWindowsError, "Unexpected .* state"):
                        core.patch_code_archive(ARCHIVE, 3502403)
                self.assertEqual(writes, [])

    def test_native_docking_state_cannot_leak_between_build_plans(self):
        for build, dock_state in [(3502403, "native"), (3640684, "native"),
                                  (2703993, "source"), (2703993, "patched")]:
            with self.subTest(build=build, dock_state=dock_state):
                with mock.patch.object(core, "run_python_patcher", return_value=dock_state) as run:
                    with self.assertRaisesRegex(core.FrontierWindowsError, "Unexpected station-docking state"):
                        core.patch_code_archive(ARCHIVE, build)
                self.assertTrue(all(call.kwargs["check"] for call in run.call_args_list))

    def test_unknown_exact_builds_fail_before_child_inspection_or_mutation(self):
        for build in [0, 2703994, 3502404, 3450341, None, "3502403", True]:
            with self.subTest(build=build), mock.patch.object(core, "run_python_patcher") as run:
                for action in [lambda: core.code_patch_states(ARCHIVE, build),
                               lambda: core.expected_code_states(build, "source"),
                               lambda: core.patch_code_archive(ARCHIVE, build)]:
                    with self.assertRaisesRegex(core.FrontierWindowsError, "No exact client code patch plan"):
                        action()
                run.assert_not_called()

    def test_writer_success_without_verified_transition_is_not_reported_ready(self):
        states, writes = {"docking": "native", "features": "source"}, []
        with mock.patch.object(core, "run_python_patcher", side_effect=self.dispatch(states, writes, update=False)):
            with self.assertRaisesRegex(core.FrontierWindowsError, "did not reach the exact patched state"):
                core.patch_code_archive(ARCHIVE, 2703993)
        self.assertEqual(writes, [core.FEATURE_PATCHER])


if __name__ == "__main__":
    unittest.main()
