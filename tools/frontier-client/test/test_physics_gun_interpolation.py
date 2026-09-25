"""Physics Gun interpolation changes presentation curves only."""

import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "physics_gun_interpolation_adapter", ROOT / "physics_gun_interpolation_adapter.py")
physics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(physics)


def sample(revision, x, sim_ms, mode="update", generation="lease-1"):
    return {"moduleTypeID": 99999, "systemID": 30000142,
            "worldEntityID": 9100, "sourceEntityID": 7000,
            "generation": generation, "revision": revision,
            "simTimeMs": sim_ms, "mode": mode,
            "position": [x, 0, 0], "orientation": [0, 0, 0, 1]}


class Adapter:
    def __init__(self):
        self.value = None


class Michelle:
    __notifyevents__ = ()

    def __init__(self):
        self.ball = types.SimpleNamespace(model=types.SimpleNamespace(
            translationCurve="native-position", rotationCurve="native-rotation"))

    def GetBall(self, _world_id):
        return self.ball

    def RemoveBallpark(self):
        return "removed"

    def Stop(self):
        return "stopped"

    def DoSimClockRebase(self, _times):
        return "rebased"


class PhysicsInterpolationTests(unittest.TestCase):
    def setUp(self):
        physics.session = types.SimpleNamespace(solarsystemid2=30000142)
        trinity = types.ModuleType("trinity")
        trinity.Tr2TranslationAdapter = Adapter
        trinity.Tr2RotationAdapter = Adapter
        geo2 = types.ModuleType("geo2")
        geo2.Vector = lambda *parts: parts
        uthread2 = types.ModuleType("uthread2")
        uthread2.start_tasklet = lambda *args: None
        self.names = ("trinity", "geo2", "uthread2")
        self.old = {name: sys.modules.get(name) for name in self.names}
        sys.modules.update(trinity=trinity, geo2=geo2, uthread2=uthread2)
        self.michelle_type = type("PatchedMichelle", (Michelle,), {})
        physics._evejs_install_physics_gun_interpolation({"Michelle": self.michelle_type})
        self.michelle = self.michelle_type()

    def tearDown(self):
        for name, old in self.old.items():
            if old is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old

    def test_interpolates_and_restores_visual_curves(self):
        with mock.patch.object(physics, "_evejs_phys_clock_ms", side_effect=[1900, 2000]):
            self.michelle.OnPhysicsGunPose(sample(1, 0, 1000, "start"))
            self.michelle.OnPhysicsGunPose(sample(2, 100, 1100))
        physics._evejs_phys_tick(self.michelle, 2100)
        model = self.michelle.ball.model
        self.assertEqual(model.translationCurve.value, (50.0, 0.0, 0.0))
        self.assertEqual(model.rotationCurve.value, (0.0, 0.0, 0.0, 1.0))
        # An old release cannot clear a newer generation.
        self.michelle.OnPhysicsGunPose(sample(1, 0, 1000, "stop"))
        self.assertIsInstance(model.translationCurve, Adapter)
        self.michelle.OnPhysicsGunPose(sample(3, 100, 1200, "stop"))
        self.assertEqual(model.translationCurve, "native-position")
        self.assertEqual(model.rotationCurve, "native-rotation")
        self.michelle.OnPhysicsGunPose(sample(2, 100, 1100))
        self.assertFalse(self.michelle._evejs_physics_pose_tracks)

    def test_invalid_input_and_optional_model_failure_do_not_break_michelle(self):
        wrong_type = sample(1, 0, 1000, "start")
        wrong_type["moduleTypeID"] = 95317
        self.michelle.OnPhysicsGunPose(wrong_type)
        self.assertFalse(getattr(self.michelle, "_evejs_physics_pose_tracks", {}))
        with mock.patch.object(physics, "_evejs_phys_clock_ms", return_value=2000):
            self.michelle.OnPhysicsGunPose(sample(1, 0, 1000, "start"))
        model = self.michelle.ball.model
        with mock.patch.object(sys.modules["trinity"], "Tr2RotationAdapter", side_effect=RuntimeError):
            physics._evejs_phys_tick(self.michelle, 2050)
        self.assertEqual(model.translationCurve, "native-position")
        physics._evejs_phys_tick(self.michelle, 2050)
        self.assertIsInstance(model.translationCurve, Adapter)
        self.assertEqual(self.michelle.DoSimClockRebase((1, 2)), "rebased")
        self.assertEqual(model.translationCurve, "native-position")
        self.assertEqual(self.michelle.Stop(), "stopped")

    def test_out_of_order_samples_rotation_and_model_replacement(self):
        first = physics._evejs_phys_parse(sample(1, 0, 1000, "start"))
        second_payload = sample(2, 100, 1100)
        second_payload["orientation"] = [0, 0, 1, 0]
        second = physics._evejs_phys_parse(second_payload)
        track = physics._EvejsPhysicsPoseTrack(first, 1900)
        self.assertTrue(track.push(second, 2000))
        self.assertFalse(track.push(first, 2100))
        pose = track.pose(2100)
        self.assertAlmostEqual(pose["position"][0], 50)
        self.assertAlmostEqual(pose["orientation"][2], 2 ** -0.5, places=6)
        self.assertAlmostEqual(pose["orientation"][3], 2 ** -0.5, places=6)
        track.render(self.michelle, 2100)
        old_model = self.michelle.ball.model
        self.michelle.ball.model = types.SimpleNamespace(
            translationCurve="new-native-position", rotationCurve="new-native-rotation")
        track.render(self.michelle, 2100)
        self.assertEqual(old_model.translationCurve, "native-position")
        self.assertEqual(old_model.rotationCurve, "native-rotation")
        track.restore()
        self.assertEqual(self.michelle.ball.model.translationCurve, "new-native-position")

    def test_slow_scene_cadence_remains_smooth_and_never_extrapolates(self):
        for interval in (50, 100, 250):
            with self.subTest(interval=interval):
                first = physics._evejs_phys_parse(sample(1, 0, 1000, "start"))
                second = physics._evejs_phys_parse(sample(2, 100, 1000 + interval))
                track = physics._EvejsPhysicsPoseTrack(first, 1900)
                self.assertTrue(track.push(second, 2000))
                delay = max(100, min(500, interval * 1.5))
                halfway = track.pose(2000 + delay - interval / 2)
                self.assertAlmostEqual(halfway["position"][0], 50)
                self.assertEqual(track.pose(3000)["position"], (100.0, 0.0, 0.0))

    def test_terminal_packet_prevents_delayed_pose_resurrection(self):
        with mock.patch.object(physics, "_evejs_phys_clock_ms", return_value=2000):
            self.michelle.OnPhysicsGunPose(sample(1, 0, 1000, "start"))
            self.michelle.OnPhysicsGunPose(sample(3, 100, 1200, "stop"))
            self.michelle.OnPhysicsGunPose(sample(2, 100, 1100))
            self.assertFalse(self.michelle._evejs_physics_pose_tracks)
            self.michelle.OnPhysicsGunPose(sample(4, 100, 1300))
            self.assertFalse(self.michelle._evejs_physics_pose_tracks)
            self.michelle.OnPhysicsGunPose(sample(1, 200, 1400, "start", "lease-2"))
            self.assertEqual(self.michelle._evejs_physics_pose_tracks[9100].generation,
                             "lease-2")
            self.michelle.OnPhysicsGunPose(sample(5, 50, 1150, "stop"))
            self.assertEqual(self.michelle._evejs_physics_pose_tracks[9100].generation,
                             "lease-2")


if __name__ == "__main__":
    unittest.main()
