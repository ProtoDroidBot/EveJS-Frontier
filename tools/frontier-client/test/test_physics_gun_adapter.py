import importlib.util
from pathlib import Path
import unittest


ADAPTER_PATH = Path(__file__).resolve().parents[1] / "physics_gun_adapter.py"
spec = importlib.util.spec_from_file_location("physics_gun_adapter", ADAPTER_PATH)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class PhysicsGunAdapterTests(unittest.TestCase):
    def test_type_overlay_preserves_existing_rows_and_localizes_name(self):
        class Loader:
            @classmethod
            def GetData(cls):
                return {95317: type("Row", (), {"typeNameID": 1046773, "groupID": 4767})(),
                        42: object()}

        namespace = {"__name__": "evetypes.data", "Types": Loader}
        adapter._evejs_install_physics_gun(namespace)
        data = Loader.GetData()
        self.assertEqual(data[99999].typeNameID, adapter.PHYSICS_GUN_NAME_ID)
        self.assertEqual(data[99999].groupID, 4767)
        self.assertIsNotNone(data[42])
        self.assertEqual(len(data), 3)

        localization = {"__name__": "localization",
                        "GetByMessageID": lambda message_id, **kwargs: f"old-{message_id}",
                        "GetImportantByMessageID": lambda message_id, **kwargs: f"important-{message_id}"}
        adapter._evejs_install_physics_gun(localization)
        self.assertEqual(localization["GetByMessageID"](adapter.PHYSICS_GUN_NAME_ID), "Physics Gun")
        self.assertEqual(localization["GetByMessageID"](42), "old-42")
        self.assertEqual(localization["GetImportantByMessageID"](42), "important-42")

    def test_missing_source_row_leaves_other_types_usable(self):
        source = {42: object()}

        class Loader:
            @classmethod
            def GetData(cls):
                return source

        adapter._evejs_install_physics_gun({"__name__": "dogma.data", "TypeDogma": Loader})
        self.assertIs(Loader.GetData(), source)
        self.assertIs(Loader.GetData()[42], source[42])

    def test_creation_module_and_held_beam_profile(self):
        exterior = type("exterior", (), {"compatible_hardpoints": ["weapon"]})()
        cutting_laser = type("CreationModule", (), {"placement": exterior})()

        class Loader:
            @classmethod
            def GetData(cls):
                return {95317: cutting_laser}

        adapter._evejs_install_physics_gun({"__name__": "frontier.creation.common.data_loader",
                                            "CreationModulesLoader": Loader})
        module = Loader.GetData()[99999]
        self.assertEqual(module.capability, "weapon")
        self.assertEqual(module.placement.compatible_hardpoints, ["weapon"])
        self.assertIs(module.placement, exterior)
        self.assertEqual(type(module.placement).__name__, "exterior")
        profiles = {95317: object()}
        adapter._evejs_install_physics_gun({"__name__": "frontier.skillshot.profile", "_PROFILES": profiles})
        self.assertIs(profiles[99999], profiles[95317])


if __name__ == "__main__":
    unittest.main()
