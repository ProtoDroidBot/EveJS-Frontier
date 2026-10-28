#!/usr/bin/env python3
"""Export an explicitly selected legacy client universe for exploration serving.

Uses the client's pure Python FSD decoder under Python 3.12; never loads game
extensions, launches the client, or changes its files. The result describes the
selected legacy world, not the retail universe belonging to targetBuild.
"""

import argparse
import configparser
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import types


FORMAT = "evejs-frontier-exploration-world-v1"
REVISION_ALGORITHM = "sha256-typed-f64-v1"
MAX_SAFE_ID = (1 << 53) - 1
RESOURCE_NAMES = (
    "regions.static", "regions.schema", "constellations.static",
    "constellations.schema", "systems.static", "systems.schema",
    "solarsystemcontent.static",
)


def field(value, name, default=None):
    if isinstance(value, dict):
        return value.get(name, default)
    try:
        return getattr(value, name)
    except (AttributeError, KeyError):
        return default


def identifier(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= MAX_SAFE_ID:
        raise ValueError(f"{label}: expected a positive safe integer ID, got {value!r}")
    return value


def number(value, label, nonnegative=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label}: expected a finite number, got {value!r}")
    if nonnegative and value < 0:
        raise ValueError(f"{label}: expected a nonnegative number, got {value!r}")
    return value


def vector(value, label):
    if value is None:
        raise ValueError(f"{label}: missing coordinates")
    if isinstance(value, dict):
        components = [value.get(axis) for axis in "xyz"]
    else:
        data = value.data if type(value).__name__ == "VectorLoader" else value
        components = list(data)
    if len(components) != 3:
        raise ValueError(f"{label}: expected exactly three coordinates")
    return {axis: number(component, f"{label}.{axis}") for axis, component in zip("xyz", components)}


def copy_fields(target, source, mapping):
    for old, new in mapping.items():
        value = field(source, old)
        if value is not None:
            target[new] = value


def named_spatial(key, row, id_field):
    identifier(key, id_field)
    if field(row, id_field) != key:
        raise ValueError(f"{id_field} key {key} differs from its row ID")
    result = {"id": key, "center": vector(field(row, "center"), f"{id_field} {key}.center")}
    copy_fields(result, row, {"name": "name", "nameID": "nameId"})
    return result


def indexed_rows(rows, label):
    result = {}
    for row in rows:
        key = identifier(row.get("id"), f"{label}.id")
        if key in result:
            raise ValueError(f"Duplicate {label} ID {key}")
        result[key] = row
    return result


def validate_world(world):
    """Reject missing coordinates, dangling hierarchy/topology, and bad IDs."""
    if world.get("format") != FORMAT:
        raise ValueError("Unsupported exploration world format")
    regions = indexed_rows(world["regions"], "region")
    constellations = indexed_rows(world["constellations"], "constellation")
    systems = indexed_rows(world["systems"], "system")
    if not regions or not constellations or not systems:
        raise ValueError("World requires nonempty region, constellation, and system tables")
    gates = {}
    local_ids = set()

    def local(row, system_id, kind):
        key = identifier(row.get("id"), f"{kind}.id")
        if key in local_ids:
            raise ValueError(f"Duplicate local object ID {key}")
        local_ids.add(key)
        vector(row.get("position"), f"{kind} {key}.position")
        identifier(row.get("typeId"), f"{kind} {key}.typeId")
        if "radiusM" in row:
            number(row["radiusM"], f"{kind} {key}.radiusM", nonnegative=True)

    for key, row in regions.items():
        vector(row.get("center"), f"region {key}.center")
    for key, row in constellations.items():
        vector(row.get("center"), f"constellation {key}.center")
        if row.get("regionId") not in regions:
            raise ValueError(f"Constellation {key} has dangling region {row.get('regionId')}")
    for key, row in systems.items():
        vector(row.get("center"), f"system {key}.center")
        constellation = constellations.get(row.get("constellationId"))
        if row.get("regionId") not in regions or constellation is None:
            raise ValueError(f"System {key} has dangling hierarchy")
        if constellation["regionId"] != row["regionId"]:
            raise ValueError(f"System {key} has inconsistent region/constellation membership")
        for neighbour in row.get("neighbours", []):
            if neighbour not in systems:
                raise ValueError(f"System {key} has dangling neighbour {neighbour}")
        for name in ("radiusM", "frostLineM", "habitableZoneInnerM", "habitableZoneOuterM"):
            if name in row:
                number(row[name], f"system {key}.{name}", nonnegative=True)
        for name in ("sun", "secondarySun"):
            if name in row:
                local(row[name], key, name)
        planets = indexed_rows(row.get("planets", []), "planet")
        system_celestial_ids = set(planets)
        system_celestial_ids.update(row[name]["id"] for name in ("sun", "secondarySun") if name in row)
        lagrange_ids = set()
        for planet in planets.values():
            local(planet, key, "planet")
            if planet.get("hostCelestialId") and planet["hostCelestialId"] not in system_celestial_ids:
                raise ValueError(f"Planet {planet['id']} has dangling host celestial")
            for moon in planet.get("moons", []):
                local(moon, key, "moon")
            for point in planet.get("lagrangePoints", []):
                local(point, key, "lagrange point")
                lagrange_ids.add(point["id"])
        for gate in row.get("stargates", []):
            local(gate, key, "stargate")
            if gate.get("planetId") and gate["planetId"] not in planets:
                raise ValueError(f"Stargate {gate['id']} has dangling planet")
            if gate.get("lagrangePointId") and gate["lagrangePointId"] not in lagrange_ids:
                raise ValueError(f"Stargate {gate['id']} has dangling lagrange point")
            gates[gate["id"]] = (key, gate)
    for key, (system_id, gate) in gates.items():
        destination = gates.get(gate.get("destinationGateId"))
        if destination is None or destination[0] != gate.get("destinationSystemId"):
            raise ValueError(f"Stargate {key} has dangling/inconsistent destination")
        if destination[1].get("destinationGateId") != key:
            raise ValueError(f"Stargate {key} has nonreciprocal destination")
    for key in world.get("starterSystemIds", []):
        if key not in systems:
            raise ValueError(f"Starter system {key} is absent from the selected world")
    # Check every exported numeric field, including optional nested orbital data.
    def finite_tree(value, path):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"{path}: nonfinite number")
        if isinstance(value, dict):
            for key, child in value.items():
                finite_tree(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                finite_tree(child, f"{path}[{index}]")
    finite_tree(world, "world")


def normalize_world(regions, constellations, systems, content, celestial_lookup, source, target_build, starters):
    """Normalize decoded FSD records; celestial_lookup reads one system at a time."""
    system_keys = sorted(systems.keys())
    if set(system_keys) != set(content.keys()):
        raise ValueError("System catalog and solar system content have different ID coverage")
    gate_systems = {}
    for key in system_keys:
        for gate_id in field(content[key], "stargates", {}).keys():
            if gate_id in gate_systems:
                raise ValueError(f"Duplicate source stargate ID {gate_id}")
            gate_systems[gate_id] = key
    world = {
        "format": FORMAT, "source": source, "targetBuild": target_build,
        "regions": [], "constellations": [], "systems": [],
        "starterSystemIds": sorted(set(starters)),
    }
    for key in sorted(regions.keys()):
        row = named_spatial(key, regions[key], "regionID")
        copy_fields(row, regions[key], {"nebulaID": "nebulaId", "factionID": "factionId", "descriptionID": "descriptionId"})
        world["regions"].append(row)
    for key in sorted(constellations.keys()):
        row = named_spatial(key, constellations[key], "constellationID")
        row["regionId"] = field(constellations[key], "regionID")
        copy_fields(row, constellations[key], {"factionID": "factionId"})
        world["constellations"].append(row)

    for key in system_keys:
        catalog, detail = systems[key], content[key]
        if field(detail, "solarSystemID") != key:
            raise ValueError(f"System content key {key} differs from its row ID")
        row = named_spatial(key, catalog, "solarSystemID")
        if row["center"] != vector(field(detail, "center"), f"system content {key}.center"):
            raise ValueError(f"System {key} has inconsistent galaxy coordinates across sources")
        metadata = celestial_lookup(key)

        def meta(object_id):
            value = metadata.get(object_id)
            if value is None or value["solarSystemID"] != key:
                raise ValueError(f"System {key} has missing/misowned map object {object_id}")
            return value

        def orbit(object_id, value, moon=False, parent_id=None):
            record = {
                "id": object_id, "typeId": field(value, "typeID"),
                "position": vector(field(value, "position"), f"object {object_id}.position"),
                "radiusM": field(value, "radius"),
            }
            db = meta(object_id)
            if moon and (field(value, "orbitID") != parent_id or db.get("orbitID") != parent_id):
                raise ValueError(f"Moon {object_id} has inconsistent parent planet")
            name_id = field(value, "moonNameID" if moon else "planetNameID", db.get("celestialNameID"))
            if name_id is not None:
                record["nameId"] = name_id
            stats = field(value, "statistics")
            copy_fields(record, stats, {
                "orbitRadius": "orbitRadiusM", "orbitPeriod": "orbitPeriodS",
                "orbitClockwise": "orbitClockwise", "spectralClass": "spectralClass",
                "temperature": "temperatureK", "typeDescription": "typeDescription",
            })
            for old, new in {"orbitPlaneNormal": "orbitPlaneNormal", "orbitSemiMajorAxis": "orbitSemiMajor", "orbitSemiMinorAxis": "orbitSemiMinor", "orbitEllipseCenter": "orbitEllipseCenter"}.items():
                coordinate = field(stats, old)
                if coordinate is not None:
                    record[new] = vector(coordinate, f"object {object_id}.{old}")
            copy_fields(record, field(value, "planetAttributes"), {
                "shaderPreset": "shaderPreset", "heightMap1": "heightMap1",
                "heightMap2": "heightMap2", "population": "population",
            })
            if moon:
                if db.get("orbitIndex") is not None:
                    record["orbitIndex"] = db["orbitIndex"]
                beacon = field(value, "miningBeacon")
                if beacon is not None:
                    record["miningBeacon"] = vector(field(beacon, "position"), f"moon {object_id}.miningBeacon")
            else:
                record["celestialIndex"] = field(value, "celestialIndex")
                if db.get("orbitID"):
                    record["hostCelestialId"] = db["orbitID"]
            return record

        copy_fields(row, catalog, {
            "regionID": "regionId", "constellationID": "constellationId",
            "securityStatus": "security", "securityClass": "securityClass",
            "sunTypeID": "sunTypeId", "factionID": "factionId",
            "sunFlareGraphicID": "sunFlareGraphicId", "wormholeClassID": "wormholeClassId",
            "visualEffect": "visualEffect",
        })
        copy_fields(row, detail, {"radius": "radiusM", "frostLine": "frostLineM", "luminosity": "luminosity", "descriptionID": "descriptionId", **{name: name for name in ("fringe", "hub", "international", "regional", "border", "corridor")}})
        zone = list(field(detail, "habitableZone", []))
        if len(zone) != 2:
            raise ValueError(f"System {key} lacks a two-value habitable zone")
        row["habitableZoneInnerM"], row["habitableZoneOuterM"] = zone
        neighbours = field(catalog, "neighbours", [])
        row["neighbours"] = sorted(set(field(value, "solarSystemID") for value in neighbours))
        star = field(detail, "star")
        if star is not None:
            star_id = field(star, "id")
            star_meta = meta(star_id)
            row["sun"] = {"id": star_id, "typeId": field(star, "typeID"), "radiusM": field(star, "radius"), "position": vector(star_meta, f"sun {star_id}.position")}
            stats = field(star, "statistics")
            copy_fields(row["sun"], stats, {"spectralClass": "spectralClass", "luminosity": "luminosity", "temperature": "temperature"})
            copy_fields(row, stats, {"temperature": "sunTemperatureK"})
        secondary = field(detail, "secondarySun")
        if secondary is not None:
            row["secondarySun"] = {"id": field(secondary, "itemID"), "typeId": field(secondary, "typeID"), "effectBeaconTypeId": field(secondary, "effectBeaconTypeID"), "position": vector(field(secondary, "position"), f"system {key}.secondarySun")}
        row["planets"] = []
        planets = field(detail, "planets", {})
        for planet_id in sorted(planets.keys()):
            planet = planets[planet_id]
            record = orbit(planet_id, planet)
            moons = field(planet, "moons", {})
            record["moons"] = [orbit(moon_id, moons[moon_id], moon=True, parent_id=planet_id) for moon_id in sorted(moons.keys())]
            points = field(planet, "lagrangePoints", {})
            record["lagrangePoints"] = [{"id": point_id, "typeId": meta(point_id)["typeID"], "position": vector(points[point_id], f"lagrange point {point_id}.position")} for point_id in sorted(points.keys())]
            row["planets"].append(record)
        row["stargates"] = []
        gates = field(detail, "stargates", {})
        for gate_id in sorted(gates.keys()):
            gate = gates[gate_id]
            destination = field(gate, "destination")
            if destination not in gate_systems:
                raise ValueError(f"Stargate {gate_id} has missing destination {destination}")
            row["stargates"].append({"id": gate_id, "typeId": field(gate, "typeID"), "position": vector(field(gate, "position"), f"stargate {gate_id}.position"), "destinationGateId": destination, "destinationSystemId": gate_systems[destination], "planetId": field(gate, "planetID"), "lagrangePointId": field(gate, "lagrangePoint")})
        world["systems"].append(row)
    validate_world(world)
    return world


def fingerprint(path):
    sha256, md5 = hashlib.sha256(), hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            sha256.update(chunk)
            md5.update(chunk)
    return {"sha256": sha256.hexdigest(), "md5": md5.hexdigest(), "size": path.stat().st_size}


def load_client_world(client_root, label, expected_build, target_build, starters):
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError("Client bytecode decoding requires Python 3.12; no native client runtime is needed")
    supplied = Path(client_root).resolve()
    build_root = supplied if (supplied / "start.ini").is_file() else supplied / "stillness"
    config = configparser.ConfigParser()
    with (build_root / "start.ini").open(encoding="utf-8") as handle:
        config.read_file(handle)
    build = config.getint("main", "build")
    if build != expected_build:
        raise ValueError(f"Selected source build {build} differs from required build {expected_build}")
    index_path = build_root / "resfileindex.txt"
    index = {}
    for line in index_path.read_text(encoding="utf-8").splitlines():
        values = line.split(",")
        if len(values) >= 5:
            index[values[0].lower()] = values
    resources, digests = {}, {}
    resource_root = (build_root.parent / "ResFiles").resolve()
    for name in RESOURCE_NAMES:
        logical = "res:/staticdata/" + name
        if logical not in index:
            raise ValueError(f"Source index lacks required resource {logical}")
        entry = index[logical]
        physical = (resource_root / entry[1]).resolve()
        if not physical.is_relative_to(resource_root):
            raise ValueError(f"Source resource escapes its cache: {logical}")
        digest = fingerprint(physical)
        if digest["md5"] != entry[2] or digest["size"] != int(entry[3]):
            raise ValueError(f"Source resource differs from its index: {logical}")
        resources[name] = physical
        digests[logical] = digest
    database = build_root / "bin64/staticdata/mapObjects.db"
    archive = build_root / "code.ccp"
    for name, path in {"start.ini": build_root / "start.ini", "resfileindex.txt": index_path, "code.ccp": archive, "bin64/staticdata/mapObjects.db": database}.items():
        digests[name] = fingerprint(path)
    # No bin64 path is added, and pyFSD's optional acceleration is disabled.
    # The FSD decoder imports boot but only game-runtime entry points use it.
    sys.path.insert(0, str(archive))
    prefs = types.ModuleType("eveprefs")
    prefs.boot = types.SimpleNamespace()
    sys.modules["eveprefs"] = prefs
    sys.modules["pyFSD"] = None
    from fsd.schemas.binaryLoader import LoadFSDDataInPython
    tables = {name: LoadFSDDataInPython(str(resources[f"{name}.static"]), str(resources[f"{name}.schema"])) for name in ("regions", "constellations", "systems")}
    content = LoadFSDDataInPython(str(resources["solarsystemcontent.static"]))
    source = {
        "build": build, "label": label, "branch": config.get("main", "branch"),
        "digests": digests, "kind": "legacy-client-geography",
        "coordinateConvention": "Legacy galaxy centers and local object positions retained in meters with no axis transform",
        "scope": "Hierarchy, positions, legacy gate topology, stars, planets, moons and lagrange points; excludes NPC stations, sites, asteroid belts and new Gabriel topology",
    }
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        def celestial_lookup(system_id):
            rows = connection.execute("SELECT celestialID, celestialNameID, solarSystemID, typeID, x, y, z, orbitID, orbitIndex FROM celestials WHERE solarSystemID = ?", (system_id,))
            return {row["celestialID"]: dict(row) for row in rows}
        return normalize_world(tables["regions"], tables["constellations"], tables["systems"], content, celestial_lookup, source, target_build, starters)


def canonical_chunks(value):
    return json.JSONEncoder(ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":")).iterencode(value)


def calculate_revision(world):
    """Hash typed values identically in Python and JavaScript, including -0.

    Floating-point JSON text is runtime-specific (1.0 vs 1, exponent padding),
    so numeric values use IEEE754 big-endian bytes. Root contentRevision is
    excluded; the algorithm name and every nested value remain included.
    """
    digest = hashlib.sha256()

    def emit(value, root=False):
        if value is None:
            digest.update(b"z")
        elif isinstance(value, bool):
            digest.update(b"t" if value else b"f")
        elif isinstance(value, (int, float)):
            number(value, "revision number")
            digest.update(b"n" + struct.pack(">d", value))
        elif isinstance(value, str):
            encoded = value.encode("utf-8", errors="strict")
            digest.update(b"s" + str(len(encoded)).encode("ascii") + b":" + encoded)
        elif isinstance(value, list):
            digest.update(b"a" + str(len(value)).encode("ascii") + b":")
            for child in value:
                emit(child)
        elif isinstance(value, dict):
            keys = [key for key in value if not (root and key == "contentRevision")]
            if any(not isinstance(key, str) for key in keys):
                raise TypeError("Revision object keys must be strings")
            keys.sort(key=lambda key: key.encode("utf-8", errors="strict"))
            digest.update(b"o" + str(len(keys)).encode("ascii") + b":")
            for key in keys:
                emit(key)
                emit(value[key])
        else:
            raise TypeError(f"Unsupported revision value {type(value).__name__}")
    emit(world, root=True)
    return digest.hexdigest()


def write_world(world, output, force=False):
    output = Path(output).resolve()
    if output.exists() and not force:
        raise FileExistsError(f"Output already exists: {output}; use --force to replace it")
    world["contentRevisionAlgorithm"] = REVISION_ALGORITHM
    world["contentRevision"] = calculate_revision(world)
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=output.name + ".", suffix=".tmp", dir=output.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            for chunk in canonical_chunks(world):
                handle.write(chunk)
            handle.write("\n")
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return world["contentRevision"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-root", required=True)
    parser.add_argument("--source-label", required=True)
    parser.add_argument("--source-build", type=int, default=3502403)
    parser.add_argument("--target-build", type=int, default=3640684)
    parser.add_argument("--starter-system", type=int, action="append", default=[])
    parser.add_argument("--out", required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)
    source_root = Path(args.client_root).resolve()
    if source_root.name == "stillness":
        source_root = source_root.parent
    output = Path(args.out).resolve()
    if output.is_relative_to(source_root):
        parser.error("Output must be outside the source client installation")
    if output.exists() and not args.force:
        parser.error("Output already exists; use --force to replace it")
    world = load_client_world(args.client_root, args.source_label, args.source_build, args.target_build, args.starter_system)
    revision = write_world(world, output, args.force)
    print(json.dumps({"output": str(output), "sourceBuild": args.source_build, "targetBuild": args.target_build, "contentRevision": revision, "regions": len(world["regions"]), "constellations": len(world["constellations"]), "systems": len(world["systems"])}))


if __name__ == "__main__":
    main()
