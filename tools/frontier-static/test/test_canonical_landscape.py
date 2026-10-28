"""Canonical placements preserve old origins while rejecting reused parents."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mapper = load("canonical_landscape", ROOT / "build-canonical-landscape.py")
legacy_tests = load("legacy_landscape_test_fixture", ROOT / "test/test_temporary_landscape_world.py")


def fixture(shared=True):
    world, decoded, manifest = legacy_tests.fixture()
    world["source"] = {"build": 3572727, "label": mapper.WORLD_LABEL, "profile": mapper.WORLD_PROFILE,
                       "kind": "canonical-client-geography"}
    system = world["systems"][0]
    system["sun"].update(typeId=45031, radiusM=5)
    system["planets"][0].update(typeId=13, radiusM=2)
    system["planets"][0]["lagrangePoints"][0].update(typeId=88166, pointIndex=4)
    decoded["landscape"][0]["asteroidBelts"]["50"].update(centerCelestialID=40)
    decoded["baselineLandscape"] = copy.deepcopy(decoded["landscape"]) if shared else []
    old = {}
    for obj, group, radius, parent in [(system["sun"], 6, 5, None),
                                      (system["planets"][0], 7, 2, 40),
                                      (system["planets"][0]["lagrangePoints"][0], 4870, None, 42)]:
        old[obj["id"]] = {"solarSystemID": 30, "groupID": group, "typeID": obj["typeId"],
                          "radius": radius, "orbitID": parent, **obj["position"]}
    world["contentRevision"] = mapper.calculate_revision(world)
    placements = {"build": 3572727, "files": {"landscape": {"sha256": mapper.PLACEMENT_SHA256}},
                  "archiveSHA256": mapper.ARCHIVE_SHA256,
                  "decodedOutput": {"sha256": mapper.PLACEMENT_DECODED_SHA256}}
    return world, decoded, manifest, placements, old


class CanonicalLandscapeTests(unittest.TestCase):
    def build(self, values):
        world, decoded, manifest, placements, old = values
        return mapper.build_profile(world, decoded, manifest, placements, old.get)

    def test_compatible_catalogs_and_all_authored_origins_are_preserved(self):
        values = fixture()
        original = copy.deepcopy(values[0])
        profile = self.build(values)
        self.assertEqual(values[0], original)
        self.assertEqual(profile["format"], mapper.FORMAT)
        self.assertFalse(profile["temporary"])
        self.assertEqual(profile["source"]["build"], 3640684)
        self.assertEqual(profile["source"]["placements"]["build"], 3572727)
        self.assertEqual(profile["world"]["revision"], original["contentRevision"])
        self.assertEqual(profile["tables"]["landscapeSites"]["sites"][0]["position"], {"x": 1.1, "y": -2.2, "z": 3.3})
        self.assertEqual(len(profile["tables"]["landscapeDungeonTemplates"]["dungeons"]), 1)
        self.assertEqual(profile["systems"][0]["planets"][0]["trojans"][0]["planetId"], 42)
        self.assertEqual(profile["contentRevision"], mapper.calculate_revision(profile))

    def test_same_id_and_owner_do_not_authorize_changed_planet_geometry(self):
        values = fixture()
        values[-1][42]["radius"] = 999
        profile = self.build(values)
        self.assertEqual(profile["systems"][0]["planets"], [])
        belt = profile["systems"][0]["asteroidBelts"][0]
        self.assertNotIn("innerPlanetId", belt)
        self.assertEqual(belt["centerCelestialId"], 40)
        self.assertEqual(len(profile["tables"]["landscapeSites"]["sites"]), 2)
        self.assertEqual(profile["tables"]["landscapeSites"]["sites"][1]["unmappedAnchors"]["planetID"], 42)

    def test_changed_lagrange_point_is_refused_even_if_planet_matches(self):
        values = fixture()
        values[-1][44]["x"] = -15
        profile = self.build(values)
        self.assertEqual(profile["systems"][0]["planets"], [])
        self.assertEqual(profile["tables"]["landscapeSites"]["sites"][1]["unmappedAnchors"], {"lagrangePointID": 44})

    def test_changed_center_omits_map_belt_but_keeps_source_scene_sites(self):
        values = fixture()
        values[-1][40]["x"] = 999
        profile = self.build(values)
        self.assertEqual(profile["systems"][0]["asteroidBelts"], [])
        self.assertEqual(len(profile["tables"]["landscapeSites"]["sites"]), 2)

    def test_new_canonical_rows_need_no_older_sqlite_identity(self):
        values = fixture(shared=False)
        values[-1].clear()
        profile = self.build(values)
        self.assertEqual(profile["systems"][0]["planets"][0]["trojans"][0]["lagrangePointId"], 44)
        self.assertEqual(profile["tables"]["landscapeSites"]["sites"][0]["sourceAnchors"]["centerCelestialID"], 40)

    def test_shared_snapshot_and_base_world_binding_cannot_be_relabelled(self):
        values = fixture()
        values[1]["landscape"][0]["trojans"]["51"]["planetID"] = 999
        with self.assertRaisesRegex(ValueError, "Shared landscape row"):
            self.build(values)
        values = fixture()
        values[0]["systems"][0]["sun"]["position"]["x"] = 99
        with self.assertRaisesRegex(ValueError, "revision mismatch"):
            self.build(values)

    def test_rehashing_cannot_relabel_a_legacy_source_as_canonical(self):
        values = fixture()
        values[0]["source"]["kind"] = "legacy-client-geography"
        values[0]["contentRevision"] = mapper.calculate_revision(values[0])
        with self.assertRaisesRegex(ValueError, "Canonical source profile"):
            self.build(values)

    def test_placement_manifest_rejects_absolute_parent_and_symlink_escape_before_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            export = root / "export"
            export.mkdir()
            outside = root / "outside.jsonl"
            outside.write_text("{}\n")
            manifest = {"build": 3572727, "errors": {}, "outputs": {"landscape": {
                "sha256": mapper.PLACEMENT_DECODED_SHA256, "bytes": 3, "rows": 1}}}
            for value in (str(outside), "../outside.jsonl"):
                with self.subTest(path=value):
                    manifest["outputs"]["landscape"]["path"] = value
                    (export / "manifest.json").write_text(json.dumps(manifest))
                    with self.assertRaisesRegex(ValueError, "path escapes"):
                        mapper.read_placement(export)
            (export / "landscape.jsonl").symlink_to(outside)
            manifest["outputs"]["landscape"]["path"] = "landscape.jsonl"
            (export / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "symlink escapes"):
                mapper.read_placement(export)


if __name__ == "__main__":
    unittest.main()
