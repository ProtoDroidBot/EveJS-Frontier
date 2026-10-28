"""Hologram rendering remains local and tolerates optional client failures."""

import importlib.util
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "dungeon_prop_hologram_adapter", ROOT / "dungeon_prop_hologram_adapter.py")
holo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(holo)


class SceneObjects(list):
    def fremove(self, value):
        if value in self:
            self.remove(value)


class Node:
    def __init__(self):
        self.children = []


class LineSet:
    def __init__(self, name):
        self.name = name
        self.lines = []

    def AddLine(self, *args):
        self.lines.append(args)

    def SubmitChanges(self):
        pass


class Michelle:
    __notifyevents__ = ("DoDestinyUpdate",)

    def GetBallpark(self, _wait):
        return object()

    def RemoveBallpark(self):
        return "removed"

    def Stop(self):
        return "stopped"


class HologramTest(unittest.TestCase):
    def setUp(self):
        self.scene = types.SimpleNamespace(objects=SceneObjects())
        self.fail_scene = False
        manager = types.SimpleNamespace(
            GetRegisteredScene=lambda _name: None if self.fail_scene else self.scene)
        service = types.SimpleNamespace(GetService=lambda _name: manager)
        self.namespace = {
            "Michelle": type("TestMichelle", (Michelle,), {}),
        }
        holo.session = types.SimpleNamespace(solarsystemid2=30000142)
        holo.sm = service
        holo._evejs_install_dungeon_prop_hologram(self.namespace)
        self.michelle = self.namespace["Michelle"]()
        trinity = types.ModuleType("trinity")
        trinity.EveRootTransform = Node
        trinity.Tr2Effect = Node
        trinity.Tr2TranslationAdapter = Node
        drawutils = types.ModuleType("trinutils.drawutils")
        drawutils.CreateLineSet = LineSet
        drawutils.LINESET_FXPATH = "line.fx"
        trinutils = types.ModuleType("trinutils")
        trinutils.drawutils = drawutils
        mathext = types.ModuleType("mathext")
        mathext.quat_from_yaw_pitch_roll = lambda *angles: angles
        geo2 = types.ModuleType("geo2")
        geo2.Vector = lambda *parts: parts
        self.old_modules = {key: sys.modules.get(key) for key in
                            ("trinity", "trinutils", "mathext", "geo2")}
        sys.modules.update(trinity=trinity, trinutils=trinutils,
                           mathext=mathext, geo2=geo2)

    def tearDown(self):
        for key, old in self.old_modules.items():
            if old is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = old

    def payload(self, x):
        return {"active": True, "systemID": 30000142, "graphicID": 0,
                "radius": 10, "collisionScale": 1,
                "position": [x, 0, 0], "rotation": [0, 0, 0]}

    def test_fallback_hologram_replaces_and_clears_without_a_ball(self):
        self.michelle.OnDungeonPropMovePreview(self.payload(100))
        self.assertEqual(len(self.scene.objects), 1)
        first = self.scene.objects[0]
        self.assertGreater(len(first.children[0].lines), 0)
        self.assertFalse(first.isPickable)
        self.assertEqual(first.translationCurve.value, (100.0, 0.0, 0.0))
        self.michelle.OnDungeonPropMovePreview(self.payload(200))
        self.assertEqual(len(self.scene.objects), 1)
        self.assertIsNot(self.scene.objects[0], first)
        self.michelle.OnDungeonPropMovePreview({"active": False})
        self.assertEqual(self.scene.objects, [])

    def test_failed_scene_lookup_preserves_previous_hologram_and_cleanup_works(self):
        self.michelle.OnDungeonPropMovePreview(self.payload(100))
        first = self.scene.objects[0]
        self.fail_scene = True
        self.michelle.OnDungeonPropMovePreview(self.payload(200))
        self.assertEqual(self.scene.objects, [first])
        self.assertEqual(self.michelle.RemoveBallpark(), "removed")
        self.assertEqual(self.scene.objects, [])

    def test_authored_collision_shape_is_used_when_available(self):
        package = types.ModuleType("ballparkCommon")
        data_package = types.ModuleType("ballparkCommon.data")
        collision = types.ModuleType("ballparkCommon.data.collision")
        collision.CollisionDatabase = types.SimpleNamespace(
            get=lambda _graphic: types.SimpleNamespace(
                miniballs=[(1, 2, 3, 4)], miniboxes=[], minicapsules=[]))
        names = ("ballparkCommon", "ballparkCommon.data",
                 "ballparkCommon.data.collision")
        originals = {name: sys.modules.get(name) for name in names}
        sys.modules.update(zip(names, (package, data_package, collision)))
        try:
            lines = LineSet("authored")
            self.assertTrue(holo._evejs_holo_collision(lines, 5678, 2))
            self.assertEqual(len(lines.lines), 3 * holo._SEGMENTS)
            self.assertEqual(lines.lines[0][0][0], 2.0)
        finally:
            for name, original in originals.items():
                if original is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = original


if __name__ == "__main__":
    unittest.main()
