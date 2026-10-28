#!/usr/bin/env python3
"""Build a verified 3572727 FSD world for client3640684 without SQLite joins.

Reads the exact-loader JSONL export and independently verifies its pinned hashes
and the indexed source-client bytes. Writes only a new output world/report.
"""
from __future__ import annotations

import argparse
from collections import Counter
import configparser
import csv
import hashlib
import importlib.util
import json
import math
from pathlib import Path

_spec = importlib.util.spec_from_file_location("legacy_world_helpers", Path(__file__).with_name("export-exploration-world.py"))
legacy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(legacy)
PROFILE = "3572727-canonical-fsd-v1"
LABEL = "3572727-CANONICAL-FSD"
CONVERSION = "3572727-canonical-fsd-to-3640684-v1"
ARCHIVE = "eee139e55d95d75e897eb944c8045fb9ee1ef1b86a8672c2f453e1fffcde9f89"
CLIENT_ARCHIVE = "2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c"
FSD_SHA256 = {
    "regions.static": "f5be931910cae18a30c1d18f28e43fc75a8ceab47cf3a43cbb973ee98dae09d5",
    "regions.schema": "ecd3e71624482283ef6fc7c2d49011d9c4995439672edb5945fb8c4b41da167d",
    "constellations.static": "e4e7d95d0d6fdd42ee5bf33c91bcf046bf03201374cae4833635f319e7d13250",
    "constellations.schema": "4c36c5231f5809c92bc15eab6e455a1d96f8621437807a2e44b8067a40a4d56a",
    "systems.static": "8d1bf8e421e0a1888d66a8762281356068e94c630f1cc392ce253d9f3852205b",
    "systems.schema": "05369416d8a66a416ca3aaf28c0184ffb01adc10e7bed54285d307dd842b3296",
    "solarsystemcontent.static": "f1353309821c979619f5b24fcca8859994859486cbd7d3a24f7c9d632df5353a",
    "jumps.static": "91cfbf06955477ac40741c071bb7b390a5674632ad631ef980a6d12eca170e6c",
    "jumps.schema": "8ea9a9afe9ef0e37a68a42038bf695c93386a8b1e49929334ab6582204f1d297",
}
DECODED = {
    "regions": (274, "fb86580ad6d6e14a32a48cd74ee908f339766257a6e0a77ea6f122bb36500132"),
    "constellations": (2163, "d8d7f764ae802e45fc0bfa24bc60da27f96bc6f3d106d7c62b19859d5278b66d"),
    "systems": (24026, "7c1d67faa3e8f77a99f635f2e5ef89362bf5384f6e854ec1b0816d7f43d2c61f"),
    "solarsystemcontent": (24026, "a185f019a3b407b084817c5a4fcb6d95110cae0828d34ecf2568b770b26012e4"),
    "jumps": (5864, "9c9e00b7c26494ef03d83487575b6b58defbdf78f66db33de3894b898b8519b5"),
}
TYPE_GROUPS = {11: 7, 12: 7, 13: 7, 14: 8, 2014: 7, 2015: 7, 2016: 7, 2063: 7,
               45031: 6, 79787: 10, 79880: 10, 79881: 10, 85226: 15,
               **{88162 + i: 4870 for i in range(1, 6)}}


def fingerprint(path):
    return legacy.fingerprint(path)


def read_rows(directory, table):
    with (directory / (table + ".jsonl")).open(encoding="utf-8-sig") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def keyed(rows, key="_key"):
    result = {}
    for row in rows:
        value = legacy.identifier(row[key], key)
        if value in result:
            raise ValueError(f"Duplicate {key}: {value}")
        result[value] = row
    return result


def verify_source(root, decoded):
    ini = configparser.ConfigParser()
    ini.read(root / "stillness/start.ini", encoding="utf-8-sig")
    if ini.getint("main", "build") != 3572727 or ini.get("main", "branch") != "//frontier/demo-tool-v2":
        raise ValueError("Requires exact3572727 demo-tool-v2 source")
    digests = {n: fingerprint(root / "stillness" / n) for n in ("code.ccp", "start.ini", "resfileindex.txt")}
    if digests["code.ccp"]["sha256"] != ARCHIVE:
        raise ValueError("Source code.ccp fingerprint differs")
    entries = {}
    with (root / "stillness/resfileindex.txt").open(encoding="utf-8-sig", newline="") as f:
        for entry in csv.reader(f):
            if entry[0] in entries:
                raise ValueError("Duplicate source resource")
            entries[entry[0]] = entry
    cache = (root / "ResFiles").resolve()
    for name, sha in FSD_SHA256.items():
        logical = "res:/staticdata/" + name
        entry = entries[logical]
        path = (cache / entry[1]).resolve()
        if not path.is_relative_to(cache):
            raise ValueError("Indexed resource escapes source cache")
        value = fingerprint(path)
        if value["sha256"] != sha or value["md5"] != entry[2] or value["size"] != int(entry[3]):
            raise ValueError(f"Source resource fingerprint differs: {logical}")
        digests[logical] = value
    manifest = json.loads((decoded / "manifest.json").read_text(encoding="utf-8-sig"))
    if manifest.get("build") != 3572727 or manifest.get("errors") != {}:
        raise ValueError("Requires successful exact3572727 decoded manifest")
    outputs = {}
    for table, (rows, sha) in DECODED.items():
        meta = manifest["outputs"][table]
        value = fingerprint(decoded / (table + ".jsonl"))
        if value["sha256"] != sha or meta["sha256"] != sha or meta["rows"] != rows or meta["bytes"] != value["size"]:
            raise ValueError(f"Decoded input fingerprint differs: {table}")
        outputs[table] = {**value, "rows": rows}
    return {"build": 3572727, "label": LABEL, "kind": "canonical-client-geography", "profile": PROFILE,
            "branch": ini.get("main", "branch"), "digests": digests, "decodedOutputs": outputs,
            "coordinateConvention": "Authored galaxy centers and system-local positions in metres; no axis transform",
            "metadataPolicy": "Canonical FSD only; no mapObjects.db joins or inherited legacy metadata",
            "moonOrdinalPolicy": "1-based sorted canonical moonID within each planet; display metadata only",
            "lagrangeIndexPolicy": "pointID=400000000+index*10000000+(planetID-40000000); index1..5,type88162+index"}


def verify_catalog(client_root, proof_dir):
    if fingerprint(client_root / "stillness/code.ccp")["sha256"] != CLIENT_ARCHIVE:
        raise ValueError("Runtime client archive is not exact3640684")
    cel = json.loads((proof_dir / "celestial-catalog-validation.json").read_text())
    station = json.loads((proof_dir / "station-catalog-validation.json").read_text())
    if cel["build"] != 3640684 or cel["missingTypeIDs"] or station["runtimeClientBuild"] != 3640684 or station["missingTypeIDs"]:
        raise ValueError("Required runtime type catalogue proof is incomplete")
    if set(cel["requiredTypeIDs"]) | set(station["requiredStationTypeIDs"]) != set(TYPE_GROUPS):
        raise ValueError("Runtime type catalogue proof has wrong scope")
    for tid, group in TYPE_GROUPS.items():
        row = station["type"] if tid == 85226 else cel["types"][str(tid)]
        if row["groupID"] != group or not row.get("graphicID"):
            raise ValueError(f"Runtime type {tid} has incompatible group/graphic metadata")
    entries = {}
    with (client_root / "stillness/resfileindex.txt").open(encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            entries[row[0]] = row
    for logical, meta in station["verifiedInputs"].items():
        row = entries[logical]
        value = fingerprint(client_root / "ResFiles" / row[1])
        if value["sha256"] != meta["sha256"] or value["md5"] != row[2] or value["size"] != int(row[3]):
            raise ValueError(f"Runtime catalogue source fingerprint differs: {logical}")
    return {"build": 3640684, "codeSHA256": CLIENT_ARCHIVE, "typeIDs": sorted(TYPE_GROUPS),
            "typesAndGraphicsInputHashes": station["verifiedInputs"],
            "scope": "Exact catalog and graphic metadata presence; native rendering remains separate acceptance"}


def copy_fields(target, raw, mapping):
    for old, new in mapping.items():
        if old in raw and raw[old] is not None:
            target[new] = raw[old]


def sun(raw):
    row = {"id": raw["id"], "typeId": raw["typeID"], "position": legacy.vector(raw["position"], "sun.position"),
           "radiusM": raw["radius"], "kind": raw["kind"], "companionIndex": raw["companion_index"]}
    copy_fields(row, raw["statistics"], {"spectralClass": "spectralClass", "temperature": "temperature", "luminosity": "luminosity"})
    return row


def orbit(object_id, raw):
    row = {"id": int(object_id), "typeId": raw["typeID"], "position": legacy.vector(raw["position"], "orbit.position"), "radiusM": raw["radius"]}
    stats = raw["statistics"]
    copy_fields(row, stats, {"orbitRadius": "orbitRadiusM", "orbitPeriod": "orbitPeriodS", "orbitClockwise": "orbitClockwise",
                            "spectralClass": "spectralClass", "temperature": "temperatureK", "typeDescription": "typeDescription"})
    for old, new in {"orbitPlaneNormal": "orbitPlaneNormal", "orbitSemiMajorAxis": "orbitSemiMajor", "orbitSemiMinorAxis": "orbitSemiMinor", "orbitEllipseCenter": "orbitEllipseCenter"}.items():
        if old in stats:
            row[new] = legacy.vector(stats[old], old)
    copy_fields(row, raw.get("planetAttributes", {}), {"shaderPreset": "shaderPreset", "heightMap1": "heightMap1", "heightMap2": "heightMap2", "population": "population"})
    return row


def lagrange_index(planet_id, point_id):
    index, remainder = divmod(point_id - 400000000 - (planet_id - 40000000), 10000000)
    if remainder or index not in range(1, 6):
        raise ValueError(f"Invalid canonical Lagrange ID {point_id} for planet {planet_id}")
    return index


def validate_lagrange(planet, stars):
    host = stars[planet["hostCelestialId"]]["position"]
    pv = [planet["position"][k] - host[k] for k in "xyz"]
    pr = math.sqrt(sum(v * v for v in pv))
    if not pr or sorted(p["pointIndex"] for p in planet["lagrangePoints"]) != [1, 2, 3, 4, 5]:
        raise ValueError("Planet must have a nonzero host-relative orbit and five Lagrange points")
    for point in planet["lagrangePoints"]:
        v = [point["position"][k] - host[k] for k in "xyz"]
        radius = math.sqrt(sum(x * x for x in v))
        cosine = sum(a * b for a, b in zip(pv, v)) / (pr * radius) if radius else 0
        ratio, index = radius / pr, point["pointIndex"]
        valid = (abs(cosine - 1) < 1e-8 and ratio < 1) if index == 1 else (abs(cosine - 1) < 1e-8 and ratio > 1) if index == 2 else (abs(cosine + 1) < 1e-8 and abs(ratio - 1) < 1e-8) if index == 3 else (abs(cosine - .5) < 1e-8 and abs(ratio - 1) < 1e-8)
        if not valid:
            raise ValueError(f"Invalid Lagrange geometry {point['id']}")


def normalize_world(regions, constellations, systems, content_rows, source, starters):
    world = {"format": legacy.FORMAT, "targetBuild": 3640684, "source": source,
             "conversionPolicyRevision": CONVERSION, "regions": [], "constellations": [],
             "systems": [], "stations": [], "sourceStellarMetadata": {}, "starterSystemIds": sorted(set(starters))}
    for key, raw in sorted(regions.items()):
        row = legacy.named_spatial(key, raw, "regionID")
        copy_fields(row, raw, {"nebulaID": "nebulaId", "factionID": "factionId", "descriptionID": "descriptionId"})
        world["regions"].append(row)
    for key, raw in sorted(constellations.items()):
        row = legacy.named_spatial(key, raw, "constellationID")
        row["regionId"] = raw["regionID"]
        copy_fields(row, raw, {"factionID": "factionId"})
        world["constellations"].append(row)
    content_seen, gate_systems = set(), {}
    for raw in content_rows:
        key = legacy.identifier(raw["_key"], "content system ID")
        if key in content_seen or key not in systems or raw["solarSystemID"] != key:
            raise ValueError("Duplicate/unknown/misidentified content system")
        content_seen.add(key)
        catalog = systems[key]
        row = legacy.named_spatial(key, catalog, "solarSystemID")
        if row["center"] != legacy.vector(raw["center"], "content.center"):
            raise ValueError("Inconsistent system centers")
        copy_fields(row, catalog, {"regionID": "regionId", "constellationID": "constellationId", "securityStatus": "security", "securityClass": "securityClass", "sunTypeID": "sunTypeId", "factionID": "factionId", "sunFlareGraphicID": "sunFlareGraphicId", "wormholeClassID": "wormholeClassId", "visualEffect": "visualEffect"})
        copy_fields(row, raw, {"radius": "radiusM", "frostLine": "frostLineM", "luminosity": "luminosity", "descriptionID": "descriptionId", "interacting": "interacting", **{n: n for n in ("fringe", "hub", "international", "regional", "border", "corridor")}})
        zone = raw["habitableZone"]
        if len(zone) != 2:
            raise ValueError("Invalid habitable zone")
        row["habitableZoneInnerM"], row["habitableZoneOuterM"] = zone
        row["neighbours"] = sorted(set(n["solarSystemID"] for n in catalog["neighbours"]))
        stellar = {int(k): v for k, v in raw["stellarObjects"].items()}
        primary = raw["star"]
        if primary["id"] not in stellar or primary != stellar[primary["id"]]:
            raise ValueError("Primary star differs from stellarObjects")
        row["sun"] = sun(primary)
        row["sunTemperatureK"] = primary["statistics"]["temperature"]
        row["companionSuns"] = [sun(v) for i, v in sorted(stellar.items()) if i != primary["id"]]
        row["stellarObjects"] = []
        for i, v in sorted(stellar.items()):
            summary = {"id": i, "kind": v["kind"], "companionIndex": v["companion_index"], "separationAu": v["separation_au"]}
            copy_fields(summary, v["statistics"], {"luminosity": "luminosity", "mass": "mass", "magneticFieldStrength": "magneticFieldGauss", "temperature": "temperature"})
            row["stellarObjects"].append(summary)
        world["sourceStellarMetadata"][str(key)] = raw["stellarObjects"]
        stars = {s["id"]: s for s in [row["sun"], *row["companionSuns"]]}
        if sorted(catalog["planetItemIDs"]) != sorted(map(int, raw["planets"])):
            raise ValueError("System planet list differs from content")
        row["planets"], row["stargates"] = [], []
        for pid, p in sorted(raw["planets"].items(), key=lambda item: int(item[0])):
            planet = orbit(pid, p)
            planet.update(hostCelestialId=p["hostCelestialID"], celestialIndex=p["celestialIndex"])
            planet["name"] = f"{row.get('name', str(key))} P{planet['celestialIndex']}"
            planet["moons"] = []
            for ordinal, (mid, moon_raw) in enumerate(sorted(p["moons"].items(), key=lambda item: int(item[0])), 1):
                if ordinal > 255 or moon_raw["orbitID"] != int(pid):
                    raise ValueError("Invalid moon ordinal or parent")
                moon = orbit(mid, moon_raw)
                moon.update(orbitIndex=ordinal, name=f"{planet['name']} M{ordinal}")
                planet["moons"].append(moon)
            planet["lagrangePoints"] = []
            for lid, pos in sorted(p["lagrangePoints"].items(), key=lambda item: int(item[0])):
                index = lagrange_index(int(pid), int(lid))
                planet["lagrangePoints"].append({"id": int(lid), "pointIndex": index, "typeId": 88162 + index, "position": legacy.vector(pos, "Lagrange position"), "name": f"{planet['name']} L{index}"})
            if planet["hostCelestialId"] not in stars:
                raise ValueError("Planet host missing from full stellar collection")
            validate_lagrange(planet, stars)
            row["planets"].append(planet)
            for host_id, host in [(int(pid), p), *[(int(mid), moon) for mid, moon in p["moons"].items()]]:
                for sid, station in sorted(host.get("npcStations", {}).items(), key=lambda item: int(item[0])):
                    if station["orbitID"] != host_id or station["solarSystemID"] != key:
                        raise ValueError("Station has inconsistent canonical parent")
                    entry = {**station, "id": int(sid), "stationID": int(sid), "position": legacy.vector(station["position"], "station.position"), "name": station["stationName"], "groupID": 15, "radius": 33811}
                    entry.update(entry["position"])
                    if "lagrangePoint" in entry:
                        entry["lagrangePointID"] = entry.pop("lagrangePoint")
                    world["stations"].append(entry)
        for gid, gate in sorted(raw["stargates"].items(), key=lambda item: int(item[0])):
            if int(gid) in gate_systems:
                raise ValueError("Duplicate source gate")
            gate_systems[int(gid)] = key
            entry = {"id": int(gid), "typeId": gate["typeID"], "position": legacy.vector(gate["position"], "gate.position"), "destinationGateId": gate["destination"]}
            copy_fields(entry, gate, {"planetID": "planetId", "lagrangePoint": "lagrangePointId"})
            row["stargates"].append(entry)
        world["systems"].append(row)
    if content_seen != set(systems):
        raise ValueError("System catalog and content have different ID coverage")
    world["systems"].sort(key=lambda r: r["id"])
    world["stations"].sort(key=lambda r: r["id"])
    for system in world["systems"]:
        for gate in system["stargates"]:
            if gate["destinationGateId"] not in gate_systems:
                raise ValueError("Missing gate destination")
            gate["destinationSystemId"] = gate_systems[gate["destinationGateId"]]
    validate_world(world)
    return world


def validate_world(world):
    regions = keyed(world["regions"], "id")
    constellations = keyed(world["constellations"], "id")
    systems = keyed(world["systems"], "id")
    occupied = set(regions) | set(constellations) | set(systems)
    if len(occupied) != len(regions) + len(constellations) + len(systems):
        raise ValueError("Hierarchy ID collision")
    gates, station_hosts = {}, {}
    counts = Counter(regions=len(regions), constellations=len(constellations), systems=len(systems))

    def local(row, kind):
        key = legacy.identifier(row["id"], kind + ".id")
        if key in occupied:
            raise ValueError(f"Duplicate local ID {key}")
        occupied.add(key)
        legacy.vector(row["position"], kind + ".position")
        group = {"stars": 6, "planets": 7, "moons": 8, "lagrangePoints": 4870, "gates": 10, "stations": 15}[kind]
        if TYPE_GROUPS.get(row.get("typeId", row.get("typeID"))) != group:
            raise ValueError(f"Unsupported3640684 {kind} type")
        if "radiusM" in row:
            legacy.number(row["radiusM"], kind + ".radiusM", nonnegative=True)
        counts[kind] += 1

    for r in regions.values():
        legacy.vector(r["center"], "region.center")
    for c in constellations.values():
        legacy.vector(c["center"], "constellation.center")
        if c["regionId"] not in regions:
            raise ValueError("Dangling constellation region")
    for s in systems.values():
        legacy.vector(s["center"], "system.center")
        if s["constellationId"] not in constellations or constellations[s["constellationId"]]["regionId"] != s["regionId"]:
            raise ValueError("Dangling system hierarchy")
        if any(n not in systems for n in s["neighbours"]):
            raise ValueError("Dangling neighbour")
        stars = {row["id"]: row for row in [s["sun"], *s["companionSuns"]]}
        if len(stars) != 1 + len(s["companionSuns"]):
            raise ValueError("Duplicate companion/primary")
        for star in stars.values():
            local(star, "stars")
        planets = keyed(s["planets"], "id")
        points = {}
        for planet in planets.values():
            local(planet, "planets")
            if planet["hostCelestialId"] not in stars:
                raise ValueError("Dangling planet host")
            station_hosts[planet["id"]] = (s["id"], set(p["id"] for p in planet["lagrangePoints"]))
            for moon in planet["moons"]:
                local(moon, "moons")
                if not 1 <= moon["orbitIndex"] <= 255:
                    raise ValueError("Moon display ordinal outside schema14")
                station_hosts[moon["id"]] = (s["id"], set())
            for point in planet["lagrangePoints"]:
                local(point, "lagrangePoints")
                if lagrange_index(planet["id"], point["id"]) != point["pointIndex"] or point["typeId"] != 88162 + point["pointIndex"]:
                    raise ValueError("Lagrange index does not match source ID")
                points[point["id"]] = planet["id"]
            validate_lagrange(planet, stars)
        for gate in s["stargates"]:
            local(gate, "gates")
            if gate.get("planetId") and gate["planetId"] not in planets:
                raise ValueError("Dangling gate planet")
            if gate.get("lagrangePointId") and (gate["lagrangePointId"] not in points or (gate.get("planetId") and points[gate["lagrangePointId"]] != gate["planetId"])):
                raise ValueError("Dangling gate Lagrange parent")
            gates[gate["id"]] = (s["id"], gate)
    for sid, gate in gates.values():
        dest = gates.get(gate["destinationGateId"])
        if not dest or dest[0] != gate["destinationSystemId"] or dest[1]["destinationGateId"] != gate["id"] or dest[1]["destinationSystemId"] != sid:
            raise ValueError("Gate destination is not reciprocal")
    for station in world["stations"]:
        local(station, "stations")
        host = station_hosts.get(station["orbitID"])
        if not host or host[0] != station["solarSystemID"] or (station.get("lagrangePointID") and station["lagrangePointID"] not in host[1]):
            raise ValueError("Dangling station parent")
    if any(sid not in systems for sid in world["starterSystemIds"]):
        raise ValueError("Starter system is absent")
    def finite(v):
        if isinstance(v, float) and not math.isfinite(v):
            raise ValueError("Nonfinite artifact value")
        if isinstance(v, dict):
            for item in v.values(): finite(item)
        elif isinstance(v, list):
            for item in v: finite(item)
    finite(world)
    return dict(counts)


def build(args):
    if args.out.resolve() == args.report.resolve():
        raise ValueError("World and report must be different files")
    for output in (args.out, args.report):
        for p in (args.client_root, args.runtime_client_root, args.decoded_dir, args.catalog_proof_dir):
            if output.resolve().is_relative_to(p.resolve()):
                raise ValueError("Output must not overwrite source/runtime-client/decoded/catalog-proof inputs")
        if output.exists() and not args.replace:
            raise FileExistsError("Output already exists; use --replace for generated candidate outputs")
    source = verify_source(args.client_root.resolve(), args.decoded_dir.resolve())
    source["runtimeCatalogProof"] = verify_catalog(args.runtime_client_root.resolve(), args.catalog_proof_dir.resolve())
    regions = keyed(read_rows(args.decoded_dir, "regions"))
    constellations = keyed(read_rows(args.decoded_dir, "constellations"))
    systems = keyed(read_rows(args.decoded_dir, "systems"))
    world = normalize_world(regions, constellations, systems, read_rows(args.decoded_dir, "solarsystemcontent"), source, args.starter_system)
    # Independently check canonical jump records against their normalized gates.
    gates = {g["id"]: (s["id"], g) for s in world["systems"] for g in s["stargates"]}
    for jump in read_rows(args.decoded_dir, "jumps"):
        sid, gate = gates[jump["stargateID"]]
        if sid != jump["fromSystemID"] or gate["destinationSystemId"] != jump["toSystemID"]:
            raise ValueError("Jump records disagree with gate topology")
    counts = validate_world(world)
    revision = legacy.write_world(world, args.out, args.replace)
    report = {"format": "evejs-canonical-world-build-v1", "sourceProfile": PROFILE, "targetBuild": 3640684,
              "conversionPolicyRevision": CONVERSION, "contentRevision": revision, "counts": counts,
              "output": {"path": str(args.out.resolve()), **fingerprint(args.out)}, "source": source,
              "validation": {"sourceAndDecodedFingerprints": True, "allCelestialAndStationParents": True,
                             "allLagrangeGeometry": True, "reciprocalGatesAndJumpRecords": True,
                             "catalogMetadata3640684": True, "sqliteJoins": False,
                             "nativeGameplayAcceptance": False}}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"output": str(args.out), "contentRevision": revision, "counts": counts}), flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--client-root", type=Path, required=True)
    p.add_argument("--runtime-client-root", type=Path, required=True)
    p.add_argument("--decoded-dir", type=Path, required=True)
    p.add_argument("--catalog-proof-dir", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--report", type=Path, required=True)
    p.add_argument("--starter-system", type=int, action="append", default=[])
    p.add_argument("--replace", action="store_true")
    build(p.parse_args())


if __name__ == "__main__":
    main()
