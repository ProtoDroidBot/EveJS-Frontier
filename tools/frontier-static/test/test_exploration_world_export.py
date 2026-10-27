"""Contract tests for explicit legacy geography export (no client imports)."""

import copy
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("exploration_world_export", Path(__file__).resolve().parents[1] / "export-exploration-world.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def fixture():
    regions = {10: {"regionID": 10, "name": "Legacy region", "nameID": 100, "nebulaID": 901, "factionID": 902, "descriptionID": 903, "center": [1e18, 2e18, 3e18]}}
    constellations = {20: {"constellationID": 20, "regionID": 10, "name": "Legacy constellation", "nameID": 200, "factionID": 902, "center": [2e18, 3e18, 4e18]}}
    systems, contents, metadata = {}, {}, {}
    for system_id, other_id in ((30, 31), (31, 30)):
        systems[system_id] = {"solarSystemID": system_id, "regionID": 10, "constellationID": 20, "name": f"Legacy {system_id}", "nameID": system_id * 10, "center": [system_id * 1e16, 7e17, 8e17], "securityStatus": 0.0, "sunTypeID": 45031, "neighbours": [{"solarSystemID": other_id}]}
        planet_id, gate_id, star_id, point_id = system_id * 100, system_id * 100 + 1, system_id * 100 + 2, system_id * 100 + 3
        contents[system_id] = {"solarSystemID": system_id, "center": systems[system_id]["center"], "radius": 5e12, "frostLine": 1e11, "habitableZone": [2e10, 3e10], "star": {"id": star_id, "typeID": 45031, "radius": 5e8, "statistics": {"temperature": 6000, "spectralClass": "G2"}}, "planets": {planet_id: {"typeID": 2016, "position": [1e10, 2e9, -3e10], "radius": 6e6, "celestialIndex": 1, "statistics": {"orbitRadius": 4e10, "orbitPeriod": 5e7, "orbitPlaneNormal": [0, 1, 0]}, "moons": {}, "lagrangePoints": {point_id: [2e10, 3e9, -4e10]}}}, "stargates": {gate_id: {"typeID": 79787, "position": [2e10, 3e9, -4e10], "destination": other_id * 100 + 1, "planetID": planet_id, "lagrangePoint": point_id}}}
        metadata[system_id] = {
            star_id: {"solarSystemID": system_id, "x": 0.0, "y": 0.0, "z": 0.0},
            planet_id: {"solarSystemID": system_id, "orbitID": star_id},
            point_id: {"solarSystemID": system_id, "typeID": 88163},
        }
    return regions, constellations, systems, contents, metadata


def normalized(data=None):
    regions, constellations, systems, contents, metadata = data or fixture()
    return exporter.normalize_world(regions, constellations, systems, contents, metadata.__getitem__, {"build": 3502403, "label": "3502403-MOD4-STUFF1"}, 3640684, [30])


class ExplorationExportTests(unittest.TestCase):
    def test_preserves_galaxy_and_local_coordinate_spaces_and_provenance(self):
        world = normalized()
        self.assertEqual(world["source"]["build"], 3502403)
        self.assertEqual(world["targetBuild"], 3640684)
        self.assertEqual(world["regions"][0]["nebulaId"], 901)
        self.assertEqual(world["regions"][0]["factionId"], 902)
        self.assertEqual(world["regions"][0]["descriptionId"], 903)
        self.assertEqual(world["constellations"][0]["factionId"], 902)
        self.assertEqual(world["systems"][0]["center"], {"x": 3e17, "y": 7e17, "z": 8e17})
        planet = world["systems"][0]["planets"][0]
        self.assertEqual(planet["position"], {"x": 1e10, "y": 2e9, "z": -3e10})
        self.assertEqual(planet["orbitPlaneNormal"], {"x": 0, "y": 1, "z": 0})
        self.assertNotIn("pointIndex", planet["lagrangePoints"][0])
        self.assertNotIn("revealLevel", world["systems"][0])
        self.assertEqual(world["systems"][0]["stargates"][0]["destinationSystemId"], 31)

    def test_rejects_absent_galaxy_position_instead_of_zero_fill(self):
        data = fixture()
        del data[2][30]["center"]
        with self.assertRaisesRegex(ValueError, "missing coordinates"):
            normalized(data)

    def test_rejects_nan_local_coordinates(self):
        world = normalized()
        world["systems"][0]["planets"][0]["position"]["x"] = math.nan
        with self.assertRaisesRegex(ValueError, "finite"):
            exporter.validate_world(world)

    def test_rejects_conflicting_system_coordinate_sources(self):
        data = fixture()
        data[3][30]["center"] = [0, 0, 0]
        with self.assertRaisesRegex(ValueError, "inconsistent galaxy coordinates"):
            normalized(data)

    def test_rejects_missing_source_content_and_celestial_metadata(self):
        data = fixture()
        del data[3][31]
        with self.assertRaisesRegex(ValueError, "ID coverage"):
            normalized(data)
        data = fixture()
        del data[4][30][3002]
        with self.assertRaisesRegex(ValueError, "map object"):
            normalized(data)

    def test_rejects_dangling_hierarchy_neighbour_and_gate(self):
        for mutator, message in (
            (lambda world: world["systems"][0].update(constellationId=999), "hierarchy"),
            (lambda world: world["systems"][0].update(neighbours=[999]), "neighbour"),
            (lambda world: world["systems"][0]["stargates"][0].update(destinationSystemId=999), "destination"),
            (lambda world: world["systems"][0]["stargates"][0].update(lagrangePointId=999), "lagrange point"),
            (lambda world: world["systems"][0]["planets"][0].update(hostCelestialId=999), "host celestial"),
        ):
            with self.subTest(message=message):
                world = normalized()
                mutator(world)
                with self.assertRaisesRegex(ValueError, message):
                    exporter.validate_world(world)

    def test_rejects_duplicate_ids_and_nonexistent_starter(self):
        world = normalized()
        world["systems"].append(copy.deepcopy(world["systems"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate system"):
            exporter.validate_world(world)
        world = normalized()
        world["starterSystemIds"] = [999]
        with self.assertRaisesRegex(ValueError, "Starter system"):
            exporter.validate_world(world)

    def test_deterministic_bytes_and_revision_ignore_prior_revision(self):
        world = normalized()
        with tempfile.TemporaryDirectory() as directory:
            one, two = Path(directory) / "one.json", Path(directory) / "two.json"
            revision = exporter.write_world(world, one)
            self.assertEqual(revision, exporter.write_world(world, two))
            self.assertEqual(one.read_bytes(), two.read_bytes())
            decoded = json.loads(one.read_text())
            self.assertEqual(decoded["contentRevision"], revision)
            with self.assertRaises(FileExistsError):
                exporter.write_world(world, one)

    def test_revision_uses_values_not_json_number_spelling(self):
        self.assertEqual(exporter.calculate_revision({"x": 1}), exporter.calculate_revision({"x": 1.0}))
        self.assertNotEqual(exporter.calculate_revision({"x": 0.0}), exporter.calculate_revision({"x": -0.0}))
        self.assertEqual(exporter.calculate_revision({"x": "é", "contentRevision": "old"}), exporter.calculate_revision({"x": "é"}))
        self.assertNotEqual(exporter.calculate_revision({"nested": {"contentRevision": "old"}}), exporter.calculate_revision({"nested": {}}))
        with self.assertRaises(UnicodeEncodeError):
            exporter.calculate_revision({"x": "\ud800"})


if __name__ == "__main__":
    unittest.main()
