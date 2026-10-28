"""Canonical-source invariants and fail-closed input checks; no game imports."""
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("canonical_world_export", Path(__file__).resolve().parents[1] / "export-canonical-world.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def fixture():
    regions = {10000001: {"regionID": 10000001, "center": [1e18, 2e18, -3e18], "name": "Canonical region"}}
    constellations = {20000001: {"constellationID": 20000001, "regionID": 10000001, "center": [1e18, 2e18, -3e18], "name": "Canonical constellation"}}
    systems, contents = {}, []

    def star(i, pos):
        return {"id": i, "position": pos, "typeID": 45031, "radius": 100., "kind": "MS", "companion_index": 0 if i != 40000002 else 1,
                "separation_au": 1., "orbitPeriod": 123., "statistics": {"temperature": 5000., "spectralClass": "G2", "luminosity": 1e26, "mass": 1e30}}

    def stats():
        return {"orbitRadius": 100., "orbitPeriod": 500., "orbitClockwise": False, "orbitPlaneNormal": [0., 0., 1.], "orbitSemiMajorAxis": [100., 0., 0.], "orbitSemiMinorAxis": [0., 100., 0.], "orbitEllipseCenter": [0., 0., 0.], "spectralClass": "0.0", "temperature": 200., "typeDescription": "Barren Planet"}

    for sid, star_id, gate_id, dest in ((30000001, 40000001, 60000001, 60000002), (30000002, 40000003, 60000002, 60000001)):
        planets = {}
        stars = {str(star_id): star(star_id, [0., 0., 0.])}
        if sid == 30000001:
            stars["40000002"] = star(40000002, [10., 0., 0.])
            points = {str(400000000 + i * 10000000 + 2000001): xyz for i, xyz in enumerate(
                ([100., 0., 0.], [120., 0., 0.], [-90., 0., 0.], [60., 100 * math.sqrt(.75), 0.], [60., -100 * math.sqrt(.75), 0.]), 1)}
            planets["42000001"] = {"solarSystemID": sid, "position": [110., 0., 0.], "radius": 10, "typeID": 2016,
                "celestialIndex": 1, "hostCelestialID": 40000002, "statistics": stats(), "lagrangePoints": points,
                "moons": {"48000002": {"position": [112., 0., 0.], "radius": 1., "typeID": 14, "orbitID": 42000001, "statistics": stats()},
                          "48000001": {"position": [111., 0., 0.], "radius": 1., "typeID": 14, "orbitID": 42000001, "statistics": stats()}},
                "npcStations": {"64000001": {"solarSystemID": sid, "orbitID": 42000001, "lagrangePoint": 412000001,
                    "typeID": 85226, "position": [100., 0., 0.], "stationName": "Canonical station", "ownerID": 1000442, "operationID": 51}}}
        center = [sid * 1e10, 3e18, -2e18]
        systems[sid] = {"solarSystemID": sid, "regionID": 10000001, "constellationID": 20000001, "center": center,
            "name": f"Canonical {sid}", "securityStatus": 0., "securityClass": "D1", "sunTypeID": 45031,
            "neighbours": [{"solarSystemID": 60000003 - gate_id + 30000000}], "planetItemIDs": list(map(int, planets))}
        systems[sid]["neighbours"] = [{"solarSystemID": 30000002 if sid == 30000001 else 30000001}]
        gate = {"typeID": 79881, "position": [100., 1., 0.], "destination": dest}
        if planets:
            gate.update(planetID=42000001, lagrangePoint=412000001)
        contents.append({"_key": sid, "solarSystemID": sid, "center": center, "radius": 1e12, "habitableZone": [1., 2.],
            "star": stars[str(star_id)], "stellarObjects": stars, "planets": planets, "stargates": {str(gate_id): gate}})
    return regions, constellations, systems, contents


def normalized(data=None):
    return exporter.normalize_world(*(data or fixture()), {"build": 3572727, "label": exporter.LABEL, "profile": exporter.PROFILE}, [30000001])


class CanonicalWorldTests(unittest.TestCase):
    def test_full_stellar_geometry_and_source_hosts_without_sqlite(self):
        w = normalized()
        s = w["systems"][0]
        self.assertEqual(w["targetBuild"], 3640684)
        self.assertEqual(w["source"]["build"], 3572727)
        self.assertEqual(s["center"], {"x": 3.0000001e17, "y": 3e18, "z": -2e18})
        self.assertEqual(s["companionSuns"][0]["position"], {"x": 10., "y": 0., "z": 0.})
        self.assertEqual(s["planets"][0]["hostCelestialId"], 40000002)
        self.assertEqual(w["sourceStellarMetadata"]["30000001"]["40000002"]["orbitPeriod"], 123.)
        self.assertEqual([p["pointIndex"] for p in s["planets"][0]["lagrangePoints"]], [1, 2, 3, 4, 5])
        self.assertEqual([p["typeId"] for p in s["planets"][0]["lagrangePoints"]], [88163, 88164, 88165, 88166, 88167])
        self.assertEqual([m["id"] for m in s["planets"][0]["moons"]], [48000001, 48000002])
        self.assertEqual([m["orbitIndex"] for m in s["planets"][0]["moons"]], [1, 2])
        self.assertEqual(w["stations"][0]["name"], "Canonical station")
        self.assertEqual(w["stations"][0]["lagrangePointID"], 412000001)
        self.assertEqual(w["stations"][0]["x"], 100.)

    def test_no_silent_zero_positions_or_wrong_source_parent(self):
        for mutate, message in (
            (lambda d: d[3][0]["stellarObjects"]["40000002"].pop("position"), "position"),
            (lambda d: d[3][0]["planets"]["42000001"].update(hostCelestialID=999), "host"),
            (lambda d: d[3][0]["planets"]["42000001"]["moons"]["48000001"].update(orbitID=999), "parent"),
            (lambda d: d[2][30000001].update(planetItemIDs=[]), "planet list"),
        ):
            with self.subTest(message=message):
                d = fixture()
                mutate(d)
                with self.assertRaises((ValueError, KeyError)):
                    normalized(d)

    def test_rejects_reused_ids_in_companions_moons_and_stations(self):
        for mutate in (
            lambda w: w["systems"][0]["companionSuns"][0].update(id=w["systems"][0]["sun"]["id"]),
            lambda w: w["systems"][0]["planets"][0]["moons"][0].update(id=42000001),
            lambda w: w["stations"][0].update(id=42000001),
        ):
            w = normalized()
            mutate(w)
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                exporter.validate_world(w)

    def test_rejects_lagrange_type_id_geometry_and_parent_corruption(self):
        mutations = [
            lambda w: w["systems"][0]["planets"][0]["lagrangePoints"][0].update(id=999),
            lambda w: w["systems"][0]["planets"][0]["lagrangePoints"][0].update(pointIndex=2),
            lambda w: w["systems"][0]["planets"][0]["lagrangePoints"][0].update(position={"x": -90., "y": 0., "z": 0.}),
            lambda w: w["systems"][0]["planets"][0]["lagrangePoints"][0].update(typeId=11),
            lambda w: w["systems"][0]["planets"][0]["lagrangePoints"][0].update(typeId=88164),
            lambda w: w["stations"][0].update(lagrangePointID=999),
        ]
        for mutate in mutations:
            w = normalized()
            mutate(w)
            with self.assertRaises(ValueError):
                exporter.validate_world(w)

    def test_rejects_wrong_gate_owner_and_nonreciprocal_destination(self):
        for field, value in (("destinationGateId", 999), ("destinationSystemId", 30000001), ("planetId", 999), ("lagrangePointId", 999)):
            w = normalized()
            w["systems"][0]["stargates"][0][field] = value
            with self.assertRaises(ValueError):
                exporter.validate_world(w)

    def test_rejects_unknown_client_types_nonfinite_and_missing_starters(self):
        for mutate in (
            lambda w: w["systems"][0]["sun"].update(typeId=97234),
            lambda w: w["systems"][0]["planets"][0].update(radiusM=-1),
            lambda w: w["sourceStellarMetadata"]["30000001"]["40000001"].update(orbitPeriod=math.nan),
            lambda w: w.update(starterSystemIds=[999]),
        ):
            w = normalized()
            mutate(w)
            with self.assertRaises(ValueError):
                exporter.validate_world(w)

    def test_revision_and_bytes_are_deterministic_and_provenance_bound(self):
        w = normalized()
        with tempfile.TemporaryDirectory() as d:
            one, two = Path(d) / "one.json", Path(d) / "two.json"
            rev = exporter.legacy.write_world(w, one)
            self.assertEqual(rev, exporter.legacy.write_world(w, two))
            self.assertEqual(one.read_bytes(), two.read_bytes())
            with self.assertRaises(FileExistsError):
                exporter.legacy.write_world(w, one)
            changed = copy.deepcopy(w)
            changed["conversionPolicyRevision"] = "different-policy"
            self.assertNotEqual(exporter.legacy.calculate_revision(changed), rev)

    def test_decoded_manifest_cannot_authorize_tampered_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            root, decoded = Path(d) / "client", Path(d) / "decoded"
            (root / "stillness").mkdir(parents=True)
            decoded.mkdir()
            (root / "stillness/start.ini").write_text("[main]\nbuild=3572727\nbranch=//frontier/demo-tool-v2\n")
            (root / "stillness/resfileindex.txt").write_text("")
            archive = root / "stillness/code.ccp"
            archive.write_bytes(b"fixture")
            sha = hashlib.sha256(b"original\n").hexdigest()
            (decoded / "systems.jsonl").write_bytes(b"tampered\n")
            (decoded / "manifest.json").write_text(json.dumps({"build": 3572727, "errors": {}, "outputs": {"systems": {"rows": 1, "sha256": sha, "bytes": 9}}}))
            with mock.patch.object(exporter, "ARCHIVE", hashlib.sha256(b"fixture").hexdigest()), mock.patch.dict(exporter.FSD_SHA256, {}, clear=True), mock.patch.dict(exporter.DECODED, {"systems": (1, sha)}, clear=True):
                with self.assertRaisesRegex(ValueError, "Decoded input fingerprint"):
                    exporter.verify_source(root, decoded)


if __name__ == "__main__":
    unittest.main()
