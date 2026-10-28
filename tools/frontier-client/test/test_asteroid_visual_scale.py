"""Dungeon asteroid model scale follows the loaded graphic's native bounds."""

import importlib.util
import math
import os
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "asteroid_visual_scale_adapter", ROOT / "asteroid_visual_scale_adapter.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class ScalableSpaceObject:
    def _GetScale(self):
        return self.typeData["crData"].dunRadius

    def _GetGraphicID(self):
        return 26161


class Asteroid(ScalableSpaceObject):
    pass


class Ship(ScalableSpaceObject):
    pass


class AsteroidVisualScaleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        adapter._evejs_install_asteroid_visual_scale(
            {"ScalableSpaceObject": ScalableSpaceObject})

    def make_object(self, kind, radius=30_000, native_radius=175.642):
        obj = kind()
        obj.id = 5_444_000_080_0301
        obj.radius = radius
        obj.typeData = {"crData": types.SimpleNamespace(
            dunObjectID=1_261_142, dunRadius=radius)}
        obj.model = types.SimpleNamespace(boundingSphereRadius=native_radius)
        return obj

    def test_asteroid_model_matches_destiny_radius(self):
        asteroid = self.make_object(Asteroid)
        scale = asteroid._GetScale()
        self.assertAlmostEqual(scale * asteroid.model.boundingSphereRadius, 30_000)
        self.assertLess(scale, 200)
        asteroid.model.boundingSphereRadius = 30_000
        self.assertEqual(asteroid._GetScale(), scale)

    def test_other_objects_and_non_dungeon_asteroids_keep_original_path(self):
        self.assertEqual(self.make_object(Ship)._GetScale(), 30_000)
        asteroid = self.make_object(Asteroid)
        asteroid.typeData["crData"].dunObjectID = None
        self.assertEqual(asteroid._GetScale(), 30_000)

    def test_detached_asteroid_uses_ball_radius(self):
        asteroid = self.make_object(Asteroid)
        asteroid.id = 8_600_000_000_000_001
        asteroid.typeData["crData"].dunObjectID = None
        asteroid.typeData["crData"].dunRadius = None
        self.assertAlmostEqual(
            asteroid._GetScale() * asteroid.model.boundingSphereRadius,
            asteroid.radius)

    def test_native_collision_extent_overrides_unreliable_model_bound(self):
        package = types.ModuleType("ballparkCommon")
        data_package = types.ModuleType("ballparkCommon.data")
        collision = types.ModuleType("ballparkCommon.data.collision")
        collision.CollisionDatabase = types.SimpleNamespace(
            Initialize=lambda: None,
            get=lambda _graphic: types.SimpleNamespace(
                miniballs=[(0, 0, 100, 75)]))
        names = ("ballparkCommon", "ballparkCommon.data",
                 "ballparkCommon.data.collision")
        originals = {name: sys.modules.get(name) for name in names}
        sys.modules.update(zip(names, (package, data_package, collision)))
        try:
            asteroid = self.make_object(Asteroid, native_radius=1)
            self.assertAlmostEqual(asteroid._GetScale(), 30_000 / 175)
        finally:
            adapter._evejs_collision_bounds_cache.clear()
            for name, original in originals.items():
                if original is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = original

    def test_missing_or_invalid_bounds_do_not_break_other_objects(self):
        for native_radius in (0, float("nan"), "bad"):
            asteroid = self.make_object(Asteroid, native_radius=native_radius)
            self.assertEqual(asteroid._GetScale(), 30_000)
        self.assertTrue(math.isfinite(self.make_object(Asteroid)._GetScale()))

    def test_exact_build_member_is_patchable(self):
        fixture = os.environ.get("EVE_FRONTIER_TEST_ARCHIVE")
        if not fixture:
            self.skipTest("Set EVE_FRONTIER_TEST_ARCHIVE for bytecode check")
        archive = Path(fixture)
        import zipfile
        sys.path.insert(0, str(ROOT))
        try:
            import patch_frontier_asteroid_visual_scale as patcher
        finally:
            sys.path.remove(str(ROOT))
        with zipfile.ZipFile(archive) as source:
            member = source.read(patcher.MODULE)
        state, original = patcher.inspect_member(member)
        self.assertIn(state, {"source", "patched", "outdated"})
        self.assertEqual(patcher.inspect_member(patcher.patched_member(original))[0],
                         "patched")


if __name__ == "__main__":
    unittest.main()
