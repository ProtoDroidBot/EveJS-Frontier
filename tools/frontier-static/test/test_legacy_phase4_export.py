"""Exact Phase4 schema boundaries and lossless SQLite blueprint conversion."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("phase4_dump", Path(__file__).resolve().parents[1] / "dump_frontier_static.py")
dump = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dump)


def request(resources=None):
    return {"schemaProfile": dump.LEGACY_PHASE4_PROFILE, "client": {"build": 2703993}, "resources": resources or {}}


class Phase4ExportTests(unittest.TestCase):
    def test_absent_creation_requires_exact_build_and_profile(self):
        table = (("creationTemplates", "creation_templatesLoader", "creationTemplates.jsonl"),)
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(dump, "NATIVE_TABLES", table):
            report = {"outputs": {}}
            dump.export_native_tables(request(), directory, {}, report)
            self.assertEqual(report["outputs"], {"creationTemplates.jsonl": 0})
            self.assertEqual((Path(directory) / "creationTemplates.jsonl").read_bytes(), b"")
            for wrong in ({"client": {"build": 2703993}, "resources": {}},
                          {"schemaProfile": dump.LEGACY_PHASE4_PROFILE, "client": {"build": 2702949}, "resources": {}}):
                with self.assertRaises((KeyError, ValueError)):
                    dump.export_native_tables(wrong, directory, {}, {"outputs": {}})
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(dump, "NATIVE_TABLES", (("types", "typesLoader", "types.jsonl"),)):
            with self.assertRaisesRegex(KeyError, "types"):
                dump.export_native_tables(request(), directory, {}, {"outputs": {}})

    def test_dungeons_export_without_inventing_absent_landscape_sites(self):
        dungeon = SimpleNamespace(dungeonNameID=42, entryTypeID=77, rooms={}, triggers={})
        loader = SimpleNamespace(load=lambda path: {7: dungeon})
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(dump.importlib, "import_module", return_value=loader) as imported:
            report = {"outputs": {}}
            dump.export_landscape_sites(request({"dungeons": {"physicalPath": "source"}}), directory, {42: ("Actual dungeon",)}, report)
            self.assertEqual(imported.call_args_list, [mock.call("dungeonsLoader")])
            self.assertEqual(report["outputs"]["frontierDungeonTemplates.jsonl"], 1)
            for name in ("landscapeEcosystems.jsonl", "landscapeDungeonTemplates.jsonl", "landscapeSites.jsonl"):
                self.assertEqual(report["outputs"][name], 0)
            row = json.loads((Path(directory) / "frontierDungeonTemplates.jsonl").read_text())
            self.assertEqual((row["dungeonName"], row["entryTypeID"]), ("Actual dungeon", 77))

    def create_cache(self, root, records):
        path = root / "blueprints.static"
        connection = sqlite3.connect(path)
        connection.execute("CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT, time FLOAT)")
        connection.executemany("INSERT INTO cache VALUES (?, ?, 0)", [(key, json.dumps(row)) for key, row in records])
        connection.commit()
        connection.close()
        (root / "types.jsonl").write_text("".join(json.dumps({"_key": key}) + "\n" for key in (10, 11, 12, 34)))
        return path

    def test_sqlite_blueprints_preserve_activities_and_source_bytes(self):
        blueprint = {"blueprintTypeID": 10, "maxProductionLimit": 25,
                     "activities": {"manufacturing": {"time": 900, "materials": [{"typeID": 34, "quantity": 5}], "products": [{"typeID": 11, "quantity": 1}]},
                                    "invention": {"products": [{"typeID": 12, "probability": 0.34, "quantity": 2}]}}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self.create_cache(root, [("10", blueprint)])
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            report = {"outputs": {}}
            dump.export_legacy_blueprints(request({"legacyBlueprints": {"physicalPath": str(source)}}), directory, report)
            self.assertEqual(json.loads((root / "blueprints.jsonl").read_text()), {"_key": 10, **blueprint})
            self.assertEqual(json.loads((root / "legacyBlueprintsSource.jsonl").read_text()), {"_key": 10, **blueprint})
            self.assertEqual(report["outputs"], {"blueprints.jsonl": 1, "legacyBlueprintsSource.jsonl": 1, "legacyBlueprintDiagnostics.jsonl": 0})
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)
            self.assertFalse(Path(str(source) + "-journal").exists())

    def test_sqlite_blueprints_reject_wrong_identity_and_duplicate_numeric_keys(self):
        valid = {"blueprintTypeID": 10, "maxProductionLimit": 1, "activities": {}}
        for records in ([("10", {**valid, "blueprintTypeID": 11})], [("10", valid), ("010", valid)]):
            with self.subTest(records=records), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = self.create_cache(root, records)
                with self.assertRaises(ValueError):
                    dump.export_legacy_blueprints(request({"legacyBlueprints": {"physicalPath": str(source)}}), directory, {"outputs": {}})
                self.assertFalse((root / "blueprints.jsonl").exists())

    def test_blueprint_projection_retains_valid_activities_and_reports_sorted_missing_refs(self):
        blueprint = {"_key": 10, "blueprintTypeID": 10, "maxProductionLimit": 5,
                     "activities": {"copying": {"time": 300},
                                    "manufacturing": {"materials": [{"typeID": 900, "quantity": 1}, {"typeID": 900, "quantity": 2}],
                                                      "products": [{"typeID": 901, "quantity": 1}]},
                                    "invention": {"skills": [{"typeID": 34, "level": 0}], "products": [{"typeID": 11, "quantity": 1, "probability": .34}]}}}
        original = json.loads(json.dumps(blueprint))
        projected, diagnostics = dump.project_legacy_blueprints([blueprint], {10, 11, 34})
        self.assertEqual(blueprint, original)
        self.assertEqual(projected, [{**blueprint, "activities": {key: value for key, value in blueprint["activities"].items() if key != "manufacturing"}}])
        self.assertEqual(diagnostics, [{"_key": "10:manufacturing", "blueprintTypeID": 10, "activity": "manufacturing", "reason": "unresolved-type-reference",
                                       "references": [{"field": "materials", "typeID": 900}, {"field": "products", "typeID": 901}]}])

    def test_blueprint_projection_rejects_malformed_refs_instead_of_hiding_them(self):
        for refs in (None, [{"typeID": True}], [{"typeID": 0}], [{"typeID": "900"}]):
            with self.subTest(refs=refs), self.assertRaises(ValueError):
                dump.project_legacy_blueprints([{"_key": 10, "activities": {"manufacturing": {"products": refs}}}], {10})

    def test_authored_empty_systems_keep_no_star_and_localized_names(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "map.db"
            connection = sqlite3.connect(source)
            connection.execute("CREATE TABLE celestials (celestialID, celestialNameID, solarSystemID, typeID, groupID, radius, x, y, z, orbitID, orbitIndex, celestialIndex)")
            connection.execute("CREATE TABLE npcStations (stationID, orbitID, solarSystemID, ownerID, typeID, x, y, z, operationID, reprocessingEfficiency, reprocessingStationsTake, reprocessingHangarFlag, isConquerable, useOperationName, orbitIndex, celestialIndex)")
            connection.close()
            systems = {32000001: SimpleNamespace(nameID=42, constellationID=20, regionID=10, center=[1., 2., 3.], planetItemIDs=[])}
            tables = [systems, {}, {}, {32000001: SimpleNamespace(planets={}, stargates={}, radius=10., visualEffect="source-effect", disallowedAnchorCategories=[65], disallowedAnchorGroups=[7, 8])}, {}, []]
            req = request({key: {"physicalPath": key} for key in ("systems", "systemsSchema", "regions", "regionsSchema", "constellations", "constellationsSchema", "solarSystemContent", "locationCache", "jumps", "jumpsSchema")})
            req["mapObjectsDb"] = {"physicalPath": str(source)}
            report = {"outputs": {}}
            with mock.patch.object(dump, "load_static", side_effect=tables):
                dump.export_universe_tables(req, directory, report, {42: ("Authored void system",)})
            row = json.loads((Path(directory) / "mapSolarSystems.jsonl").read_text())
            self.assertEqual(row["name"], {"en": "Authored void system"})
            self.assertEqual((row["sourceHasStar"], row["starID"], row["sunTypeID"], row["starTemperature"]), (False, 0, 0, 0.))
            self.assertEqual((row["visualEffect"], row["disallowedAnchorCategories"], row["disallowedAnchorGroups"]), ("source-effect", [65], [7, 8]))
            self.assertEqual(report["legacyUniverse"]["authoredEmptySystemIDs"], [32000001])
            self.assertEqual((Path(directory) / "mapStars.jsonl").read_bytes(), b"")


if __name__ == "__main__":
    unittest.main()
