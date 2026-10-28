"""Temporary cross-cycle mapping preserves content without guessing parents."""
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("temporary_landscape", Path(__file__).resolve().parents[1] / "build-temporary-landscape-world.py")
mapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mapper)


def fixture():
    world = {"format": "evejs-frontier-exploration-world-v1", "targetBuild": 3640684, "source": {"label": "3502403-MOD4-STUFF1", "build": 3502403},
        "regions": [{"id": 10}], "constellations": [{"id": 20}], "systems": [{"id": 30,
            "sun": {"id": 40, "position": {"x": 0, "y": 0, "z": 0}}, "planets": [{"id": 42,
            "position": {"x": 10, "y": 0, "z": 0}, "lagrangePoints": [{"id": 44, "position": {"x": 15, "y": 0, "z": 0}}]}]}]}
    world["contentRevision"] = mapper.calculate_revision(world)
    decoded = {"referencedTypes": [{"_key": 90, "typeID": 90, "name": "Beacon", "categoryID": 2, "groupID": 995, "graphicID": 123, "radius": 5}],
        "dungeons": [{"_key": 1, "entryTypeID": 90, "rooms": {"2": {"x": 1, "y": 2, "z": 3, "objects": {"3": {
            "objectID": 3, "roomID": 2, "typeID": 90, "position": [4, 5, 6], "yaw": 70, "pitch": 20, "roll": 40, "radius": 100}}}}}],
        "ecosystem": [{"_key": 7, "name": "Target content", "spawnEnabled": 1, "entryPattern": {"beaconTypeID": 90},
            "naturalWorldPatterns": [{"dungeonID": 1, "minOccurrences": 0, "maxOccurrences": 1, "weight": 1}], "brokenWorldPatterns": []}],
        "landscape": [{"_key": 30, "asteroidBelts": {"50": {"innerCelestialID": 42, "outerCelestialID": 999,
            "innerRadius": 100, "outerRadius": 200, "sites": {"90": {"ecosystemID": 7, "position": [1.1, -2.2, 3.3]}},
            "clusters": {"70": {"arcMin": 0, "arcMax": 0, "siteIDs": [90]}}}},
            "trojans": {"51": {"planetID": 42, "lagrangePointID": 44, "controlPoints": [[1, 2, 3], [3, 4, 5]],
                "sites": {"91": {"ecosystemID": 7, "position": [-7, 8, 9]}},
                "clusters": {"71": {"siteIDs": [91], "midPoint": [-7, 8, 9]}}}}}],
        "dungeonAssetManipulations": [], "dungeonEnvironmentTemplates": []}
    manifest = {"files": {name: {"sha256": digest} for name, digest in mapper.PINNED.items()}, "outputs": {}, "decoder": {"method": "fixture"}}
    return world, decoded, manifest


class TemporaryLandscapeTests(unittest.TestCase):
    def test_preserves_sites_and_source_geometry_without_cross_system_anchor_links(self):
        world, decoded, manifest = fixture()
        before = copy.deepcopy(world)
        result = mapper.build_profile(world, decoded, manifest)
        self.assertEqual(world, before)
        self.assertTrue(result["temporary"])
        self.assertEqual(result["world"]["revision"], world["contentRevision"])
        sites = result["tables"]["landscapeSites"]["sites"]
        self.assertEqual(sites[0]["position"], {"x": 1.1, "y": -2.2, "z": 3.3})
        self.assertEqual(sites[0]["unmappedAnchors"], {"outerCelestialID": 999})
        belt = result["systems"][0]["asteroidBelts"][0]
        self.assertNotIn("outerPlanetId", belt)
        self.assertEqual(belt["innerPlanetId"], 42)
        self.assertEqual(belt["clusters"][0]["position"], {"x": 150, "y": 0, "z": 0})
        self.assertNotIn("typeId", belt, "abstract map geometry must not invent an item type")
        self.assertEqual(result["systems"][0]["planets"][0]["trojans"][0]["sites"][0]["position"], {"x": -7, "y": 8, "z": 9})
        obj = result["tables"]["landscapeDungeonTemplates"]["dungeons"][0]["rooms"][0]["objects"][0]
        self.assertEqual([obj[k] for k in ("yaw", "pitch", "roll", "radius")], [70, 20, 40, 100])
        self.assertEqual(result["contentRevision"], mapper.calculate_revision(result))

    def test_unknown_trojan_parent_and_belt_centre_keep_scene_content_but_omit_map_geometry(self):
        world, decoded, manifest = fixture()
        feature = decoded["landscape"][0]
        feature["asteroidBelts"]["50"]["centerCelestialID"] = 987
        feature["trojans"]["51"]["planetID"] = 987
        result = mapper.build_profile(world, decoded, manifest)
        self.assertEqual(len(result["tables"]["landscapeSites"]["sites"]), 2)
        self.assertEqual(result["systems"][0]["asteroidBelts"], [])
        self.assertEqual(result["systems"][0]["planets"], [])
        self.assertEqual(result["mappingReport"]["counts"]["omittedExplorationTrojans"], 1)

    def test_source_disabled_and_missing_system_are_not_implicitly_enabled_or_rebound(self):
        world, decoded, manifest = fixture()
        decoded["ecosystem"][0]["spawnEnabled"] = 0
        decoded["landscape"].append({"_key": 999, "asteroidBelts": {}, "trojans": {}})
        result = mapper.build_profile(world, decoded, manifest)
        self.assertTrue(all(not s["spawnEnabled"] for s in result["tables"]["landscapeSites"]["sites"]))
        self.assertEqual(result["mappingReport"]["counts"]["unmappedSystems"], 1)
        self.assertEqual(len(result["systems"]), 1)

    def test_rejects_reused_ids_missing_type_dungeon_and_invalid_cluster_membership(self):
        changes = [
            (lambda w, d: d["dungeons"][0]["rooms"]["2"]["objects"]["3"].update(typeID=999), "absent target type"),
            (lambda w, d: d["ecosystem"][0]["naturalWorldPatterns"][0].update(dungeonID=999), "absent dungeon"),
            (lambda w, d: d["landscape"][0]["asteroidBelts"]["50"]["clusters"]["70"].update(siteIDs=[999]), "outside its feature"),
        ]
        # Identity collision is explicit, including collisions with galaxy IDs.
        world, decoded, manifest = fixture()
        feature = decoded["landscape"][0]["asteroidBelts"].pop("50")
        decoded["landscape"][0]["asteroidBelts"]["42"] = feature
        with self.assertRaisesRegex(ValueError, "collides"): mapper.build_profile(world, decoded, manifest)
        for change, error in changes:
            world, decoded, manifest = fixture(); change(world, decoded)
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error): mapper.build_profile(world, decoded, manifest)

    def test_sun_boundary_is_not_mislabeled_as_a_planet(self):
        world, decoded, manifest = fixture()
        decoded["landscape"][0]["asteroidBelts"]["50"]["innerCelestialID"] = 40
        result = mapper.build_profile(world, decoded, manifest)
        self.assertNotIn("innerPlanetId", result["systems"][0]["asteroidBelts"][0])
        self.assertEqual(result["mappingReport"]["counts"]["omittedNonPlanetBoundaryLinks"], 1)

    def test_target_npc_threat_starter_locators_are_not_rendered_as_scenery(self):
        for type_id, role in ((91213, "threatLocator"), (91214, "npcLocator"), (91215, "starterLocator")):
            world, decoded, manifest = fixture()
            decoded["referencedTypes"].append({**decoded["referencedTypes"][0], "_key": type_id, "typeID": type_id})
            decoded["dungeons"][0]["rooms"]["2"]["objects"]["3"]["typeID"] = type_id
            result = mapper.build_profile(world, decoded, manifest)
            obj = result["tables"]["landscapeDungeonTemplates"]["dungeons"][0]["rooms"][0]["objects"][0]
            self.assertEqual(obj["role"], role)

    def test_world_hash_and_reproducible_artifact_are_enforced(self):
        world, decoded, manifest = fixture()
        one = mapper.build_profile(world, decoded, manifest)
        two = mapper.build_profile(world, decoded, manifest)
        self.assertEqual(one, two)
        world["systems"][0]["sun"]["position"]["x"] = 123
        with self.assertRaisesRegex(ValueError, "revision mismatch"): mapper.build_profile(world, decoded, manifest)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profile.json"
            mapper.write_json(path, one)
            with self.assertRaises(FileExistsError): mapper.write_json(path, two)
            self.assertEqual(json.loads(path.read_text()), one)

    def test_native_manifest_content_is_verified_before_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            manifest = {"format": "evejs-frontier-landscape-native-v1", "build": 3640684,
                "files": {name: {"sha256": digest} for name, digest in mapper.PINNED.items()},
                "outputs": {"landscape": {"path": "landscape.jsonl", "sha256": "0" * 64, "bytes": 3, "rows": 1}}}
            (path / "manifest.json").write_text(json.dumps(manifest))
            (path / "landscape.jsonl").write_text("{}\n")
            with self.assertRaisesRegex(ValueError, "integrity mismatch"): mapper.read_decoded(path)


if __name__ == "__main__": unittest.main()
