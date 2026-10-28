#!/usr/bin/env python3
"""Build a temporary cycle-7 content profile over an explicit legacy galaxy.

Reads exact-loader JSONL exports, verifies their manifest hashes, retains the
selected galaxy's IDs/coordinates, and never changes a client or live database.
Source scene placements remain system-local metres. Unresolved celestial
anchors are reported, not silently rebound to an unrelated legacy planet.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
from collections import Counter

FORMAT = "evejs-frontier-temporary-landscape-v1"
MARKERS = {"temporaryLandscapeProfile": True, "sourceBuild": 3640684}
PINNED = {
    "landscape": "6cf052f8ff7fed9562c797b18e8a1138b29d90dcd253b5e54d88a94be2f81759",
    "ecosystem": "5434f782769e8d8faaabd6e276eda75a29f7659c42cf064ac5e0d3f651f5980d",
    "dungeons": "d92a283c531ab725ff4c928dd90ee72fc8dd82718bf09da87af580ac08acc3d6",
}
# Target frontier/landscape/common/locator_types.pyc (lines 5–10), plus
# legacy locator objects still present in the target's authored dungeons.
LOCATOR_ROLES = {91211: "resourceLocator", 91212: "eventLocator", 91213: "threatLocator",
                 91214: "npcLocator", 91215: "starterLocator", 91232: "poiLocator", 91302: "entryLocator"}
_spec = importlib.util.spec_from_file_location("exploration_export", Path(__file__).with_name("export-exploration-world.py"))
_world_export = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_world_export)
calculate_revision = _world_export.calculate_revision


def positive(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= (1 << 53) - 1:
        raise ValueError(f"{label}: positive safe integer required")
    return value


def number(value, label):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError(f"{label}: finite number required")
    return value


def vector(value, label):
    parts = [value.get(k) for k in "xyz"] if isinstance(value, dict) else value
    if not isinstance(parts, (list, tuple)) or len(parts) != 3:
        raise ValueError(f"{label}: explicit 3D position required")
    return {k: number(v, label) for k, v in zip("xyz", parts)}


def entries(value, label):
    if value is None:
        return []
    if isinstance(value, list):
        return [(positive(row.get("_key", row.get("id")), label), row) for row in value]
    if not isinstance(value, dict):
        raise ValueError(f"{label}: keyed records required")
    result = []
    for key, row in value.items():
        if not str(key).isdigit() or not isinstance(row, dict):
            raise ValueError(f"{label}: invalid keyed record {key!r}")
        result.append((positive(int(key), label), row))
    return sorted(result)


def index(rows, label, key_name="_key"):
    result = {}
    for row in rows:
        key = positive(row.get(key_name), label)
        if key in result:
            raise ValueError(f"Duplicate {label} ID {key}")
        result[key] = row
    return result


def read_decoded(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest.get("format") != "evejs-frontier-landscape-native-v1" or manifest.get("build") != 3640684:
        raise ValueError("Expected exact 3640684 native export manifest")
    for name, digest in PINNED.items():
        if manifest.get("files", {}).get(name, {}).get("sha256") != digest:
            raise ValueError(f"Unrecognized source fingerprint: {name}")
    decoded = {}
    for name in ("landscape", "ecosystem", "dungeons", "referencedTypes", "dungeonAssetManipulations", "dungeonEnvironmentTemplates"):
        info = manifest["outputs"][name]
        relative = Path(info["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Export manifest path escapes decoded directory")
        payload = (directory / relative).read_bytes()
        if hashlib.sha256(payload).hexdigest() != info["sha256"] or len(payload) != info["bytes"]:
            raise ValueError(f"Decoded output integrity mismatch: {name}")
        rows = [json.loads(line) for line in payload.splitlines() if line.strip()]
        if len(rows) != info["rows"]:
            raise ValueError(f"Decoded output row count mismatch: {name}")
        decoded[name] = rows
    return manifest, decoded


def normalize_dungeon(key, raw, types):
    row = {**copy.deepcopy(raw), "_key": key, "dungeonID": key, **MARKERS}
    rooms = []
    for room_id, room in entries(raw.get("rooms"), f"dungeon {key} rooms"):
        room_row = {**copy.deepcopy(room), "roomID": room_id,
                    "position": vector([room.get("x"), room.get("y"), room.get("z")], f"room {room_id}"), "objects": []}
        for object_id, obj in entries(room.get("objects"), f"room {room_id} objects"):
            type_id = positive(obj.get("typeID"), f"object {object_id} type")
            if type_id not in types:
                raise ValueError(f"Object {object_id} references absent target type {type_id}")
            if obj.get("objectID", object_id) != object_id or obj.get("roomID", room_id) != room_id:
                raise ValueError(f"Object {object_id} identity differs from enclosing dungeon")
            room_row["objects"].append({**copy.deepcopy(obj), "objectID": object_id, "roomID": room_id,
                "typeID": type_id, "position": vector(obj.get("position"), f"object {object_id}"),
                "role": LOCATOR_ROLES.get(type_id, "scenery")})
        rooms.append(room_row)
    row["rooms"] = rooms
    if "triggers" in raw:
        row["triggers"] = [{**copy.deepcopy(trigger), "triggerID": trigger_id,
            "triggerEvents": [{**copy.deepcopy(event), "eventID": event_id} for event_id, event in entries(trigger.get("triggerEvents"), "trigger events")]}
            for trigger_id, trigger in entries(raw["triggers"], "triggers")]
    entry_type = raw.get("entryTypeID", 0)
    if entry_type and entry_type not in types:
        raise ValueError(f"Dungeon {key} references absent entry type {entry_type}")
    return row


def normalize_ecosystem(key, raw, types, dungeons):
    row = {**copy.deepcopy(raw), "_key": key, "ecosystemID": key, "entryDungeonID": 0, **MARKERS}
    pattern = raw.get("entryPattern", {})
    for name in ("beaconTypeID", "baseCloudTypeID", "postProcessTypeID"):
        type_id = pattern.get(name, 0)
        if type_id and type_id not in types:
            raise ValueError(f"Ecosystem {key} references absent {name} {type_id}")
    positive(pattern.get("beaconTypeID"), f"ecosystem {key} beacon")
    for name in ("naturalWorldPatterns", "brokenWorldPatterns"):
        for item in raw.get(name, []):
            dungeon_id = positive(item.get("dungeonID"), f"ecosystem {key} dungeon")
            if dungeon_id not in dungeons:
                raise ValueError(f"Ecosystem {key} references absent dungeon {dungeon_id}")
            lo, hi = item.get("minOccurrences"), item.get("maxOccurrences")
            if not isinstance(lo, int) or not isinstance(hi, int) or not 0 <= lo <= hi:
                raise ValueError(f"Ecosystem {key} has invalid pattern occurrences")
            if number(item.get("weight"), "pattern weight") < 0:
                raise ValueError("Pattern weight must be nonnegative")
    return row


def build_profile(world, decoded, manifest):
    if (world.get("format") != "evejs-frontier-exploration-world-v1" or
            world.get("source", {}).get("label") != "3502403-MOD4-STUFF1" or
            world.get("source", {}).get("build") != 3502403 or world.get("targetBuild") != 3640684):
        raise ValueError("Select the 3502403-MOD4-STUFF1 exploration world")
    if calculate_revision(world) != world.get("contentRevision"):
        raise ValueError("Selected world content revision mismatch")
    systems = index(world["systems"], "system", "id")
    types = index(decoded["referencedTypes"], "target type", "typeID")
    dungeon_raw = index(decoded["dungeons"], "dungeon")
    dungeons = {key: normalize_dungeon(key, row, types) for key, row in dungeon_raw.items()}
    ecosystems = {key: normalize_ecosystem(key, row, types, dungeons) for key, row in index(decoded["ecosystem"], "ecosystem").items()}
    landscapes = index(decoded["landscape"], "landscape system")
    occupied = set(systems)
    occupied.update(row["id"] for name in ("regions", "constellations") for row in world[name])
    anchors = {}
    planets = {}
    for system in systems.values():
        local = {sun["id"]: sun for sun in [system.get("sun"), system.get("secondarySun"), *system.get("companionSuns", [])] if sun}
        planets[system["id"]] = {p["id"]: p for p in system.get("planets", [])}
        for planet in system.get("planets", []):
            local[planet["id"]] = planet
            for obj in [*planet.get("moons", []), *planet.get("lagrangePoints", [])]: local[obj["id"]] = obj
        for gate in system.get("stargates", []): local[gate["id"]] = gate
        anchors[system["id"]] = local
        occupied.update(local)
    counts = Counter()
    reports = []
    sites = []
    patches = []
    source_feature_records = []
    seen = set()

    def admit_id(key, label):
        positive(key, label)
        if key in occupied or key in seen:
            raise ValueError(f"Source {label} ID {key} collides with selected world/another content object")
        seen.add(key)

    for system_id, raw in sorted(landscapes.items()):
        counts["sourceSystems"] += 1
        if system_id not in systems:
            reports.append({"systemID": system_id, "reason": "SYSTEM_NOT_IN_SELECTED_WORLD"})
            counts["unmappedSystems"] += 1
            continue
        counts["mappedSystems"] += 1
        system = systems[system_id]
        patch = {"id": system_id, "asteroidBelts": [], "planets": []}
        planet_patches = {}
        for field, kind in (("asteroidBelts", "asteroidBelt"), ("trojans", "trojan")):
            for feature_id, feature in entries(raw.get(field), field):
                admit_id(feature_id, "feature")
                counts["sourceFeatures"] += 1
                source_anchors = {name: value for name in ("innerCelestialID", "outerCelestialID", "centerCelestialID", "planetID", "lagrangePointID") if (value := feature.get(name))}
                unresolved = {name: value for name, value in source_anchors.items() if value not in anchors[system_id]}
                if kind == "trojan":
                    planet = planets[system_id].get(feature.get("planetID"))
                    if not planet or feature.get("lagrangePointID") not in {p["id"] for p in planet.get("lagrangePoints", [])}:
                        unresolved.update({"planetID": feature.get("planetID"), "lagrangePointID": feature.get("lagrangePointID")})
                if unresolved:
                    counts["featuresWithUnmappedAnchors"] += 1
                    reports.append({"systemID": system_id, "featureID": feature_id, "featureKind": kind,
                                    "reason": "SOURCE_CELESTIAL_ANCHOR_NOT_IN_SELECTED_SYSTEM", "references": unresolved})
                source_feature = {"systemID": system_id, "featureID": feature_id, "featureKind": kind,
                                  "sourceAnchors": source_anchors, "unmappedAnchors": unresolved}
                source_feature_records.append(source_feature)
                site_map = {}
                for site_id, site in entries(feature.get("sites"), "sites"):
                    admit_id(site_id, "site")
                    ecosystem_id = positive(site.get("ecosystemID"), "site ecosystem")
                    if ecosystem_id not in ecosystems:
                        raise ValueError(f"Site {site_id} references absent ecosystem {ecosystem_id}")
                    ecosystem = ecosystems[ecosystem_id]
                    type_id = ecosystem["entryPattern"]["beaconTypeID"]
                    metadata = types[type_id]
                    position = vector(site.get("position"), f"site {site_id}")
                    site_map[site_id] = {"id": site_id, "typeId": type_id, "position": position, "ecosystemId": ecosystem_id}
                    sites.append({"_key": site_id, "itemID": site_id, "siteID": site_id,
                        "solarSystemID": system_id, "typeID": type_id, "groupID": metadata["groupID"], "categoryID": metadata["categoryID"],
                        "graphicID": metadata.get("graphicID", 0), "radius": metadata.get("radius", 0),
                        "itemName": ecosystem.get("name") or metadata.get("name") or f"Site {site_id}",
                        "position": position, "featureID": feature_id, "featureKind": kind,
                        "featureTags": copy.deepcopy(feature.get("tags", [])), "featureWeight": feature.get("weight", 0),
                        "ecosystemID": ecosystem_id, "ecosystemName": ecosystem.get("name", ""),
                        "dungeonID": 0, "entryPattern": copy.deepcopy(ecosystem["entryPattern"]),
                        "sourceAnchors": source_anchors, "unmappedAnchors": unresolved,
                        "spawnEnabled": bool(ecosystem.get("spawnEnabled", True)), **MARKERS})
                    counts["mappedSites"] += 1
                    if not ecosystem.get("spawnEnabled", True): counts["sourceDisabledSites"] += 1
                clusters = []
                clustered = set()
                for cluster_id, cluster in entries(feature.get("clusters"), "clusters"):
                    admit_id(cluster_id, "cluster")
                    cluster_sites = []
                    for site_id in cluster.get("siteIDs", []):
                        positive(site_id, "cluster site")
                        if site_id not in site_map:
                            raise ValueError(f"Cluster {cluster_id} references site {site_id} outside its feature")
                        if site_id in clustered:
                            raise ValueError(f"Site {site_id} belongs to more than one cluster")
                        clustered.add(site_id)
                        cluster_sites.append(site_map[site_id])
                    clusters.append((cluster_id, cluster, cluster_sites))
                    counts["sourceClusters"] += 1
                if set(site_map) != clustered:
                    raise ValueError(f"Feature {feature_id} has sites without authored cluster membership")
                if kind == "asteroidBelt":
                    # Nullable planet bounds are descriptive; do not point them
                    # at another system. An unresolved non-null center prevents
                    # a map belt because its local centre cannot be established.
                    center_id = feature.get("centerCelestialID", 0)
                    if center_id and center_id not in anchors[system_id]:
                        counts["omittedExplorationBelts"] += 1
                        continue
                    center = vector(anchors[system_id][center_id]["position"], "belt centre") if center_id else {"x": 0, "y": 0, "z": 0}
                    inner = number(feature.get("innerRadius"), "belt inner radius")
                    outer = number(feature.get("outerRadius"), "belt outer radius")
                    if not 0 <= inner <= outer: raise ValueError(f"Belt {feature_id} has invalid radii")
                    belt = {"id": feature_id, "position": center, "innerRadiusM": inner, "outerRadiusM": outer, "clusters": []}
                    for source_name, target_name in (("innerCelestialID", "innerPlanetId"), ("outerCelestialID", "outerPlanetId"), ("centerCelestialID", "centerCelestialId")):
                        value = feature.get(source_name)
                        allowed = anchors[system_id] if source_name == "centerCelestialID" else planets[system_id]
                        if value and value in allowed: belt[target_name] = value
                        elif value and value in anchors[system_id]:
                            counts["omittedNonPlanetBoundaryLinks"] += 1
                            reports.append({"systemID": system_id, "featureID": feature_id, "featureKind": kind,
                                            "reason": "SOURCE_BOUNDARY_IS_NOT_A_PLANET", "references": {source_name: value}})
                    for source_name, target_name in (("minorRadius", "minorRadiusM"), ("minorRadiusVertical", "minorRadiusVerticalM")):
                        if source_name in feature: belt[target_name] = number(feature[source_name], source_name)
                    for cluster_id, cluster, cluster_sites in clusters:
                        lo, hi = number(cluster.get("arcMin"), "arcMin"), number(cluster.get("arcMax"), "arcMax")
                        radius, angle = (inner + outer) / 2, (lo + hi) / 2
                        position = {"x": center["x"] + radius * math.cos(angle), "y": center["y"], "z": center["z"] + radius * math.sin(angle)}
                        belt["clusters"].append({"id": cluster_id, "position": position, "arcMin": lo, "arcMax": hi, "sites": cluster_sites})
                    patch["asteroidBelts"].append(belt)
                    counts["explorationBelts"] += 1
                elif unresolved:
                    counts["omittedExplorationTrojans"] += 1
                else:
                    cps = [vector(cp, "Trojan control point") for cp in feature.get("controlPoints", [])]
                    if not cps: raise ValueError(f"Trojan {feature_id} has no control points")
                    position = {axis: sum(cp[axis] for cp in cps) / len(cps) for axis in "xyz"}
                    # The target wire has one midPoint per Trojan while cFSD may
                    # have several clusters. The control-point centroid is an
                    # explicit temporary representative; all authored sites stay.
                    midpoints = [vector(c["midPoint"], "Trojan midpoint") for _, c, _ in clusters]
                    midpoint = {axis: sum(p[axis] for p in midpoints) / len(midpoints) for axis in "xyz"} if midpoints else position
                    trojan = {"id": feature_id, "position": position, "midPoint": midpoint,
                              "planetId": feature["planetID"], "lagrangePointId": feature["lagrangePointID"],
                              "controlPoints": cps, "sites": list(site_map.values())}
                    planet_patch = planet_patches.setdefault(feature["planetID"], {"id": feature["planetID"], "trojans": []})
                    planet_patch["trojans"].append(trojan)
                    counts["explorationTrojans"] += 1
        patch["planets"] = [planet_patches[k] for k in sorted(planet_patches)]
        patches.append(patch)
    report = {"counts": dict(counts), "coordinatePolicy": "preserve-authored-system-local-metres",
        "systemMapping": "exact-source-system-id-in-selected-world",
        "anchorPolicy": "only-reference-celestials-in-the-same-selected-system; retain-scene-sites-with-unmapped-anchor-report",
        "derivedMapPositions": {"beltClusters": "client midpoint-radius/mean-arc formula", "trojans": "control-point centroid; mean authored cluster midpoint"},
        "unmapped": reports, "sourceFeatureMappings": source_feature_records}
    profile = {"format": FORMAT, "temporary": True, "replacementCondition": "replace when full era 6 cycle 7 files are supplied",
        "source": {"build": 3640684, "files": manifest["files"], "decodedOutputs": manifest["outputs"], "decoder": manifest.get("decoder")},
        "world": {"label": "3502403-MOD4-STUFF1", "revision": world["contentRevision"]},
        "contentRevisionAlgorithm": "sha256-typed-f64-v1", "systems": patches,
        "tables": {"landscapeSites": {"sites": sites}, "landscapeEcosystems": {"ecosystems": list(ecosystems.values())},
            "landscapeDungeonTemplates": {"dungeons": list(dungeons.values())}, "frontierDungeonTemplates": {"dungeons": list(dungeons.values())},
            "itemTypes": {"types": [{**row, **MARKERS} for row in types.values()]}},
        "supportingData": {name: decoded[name] for name in ("dungeonAssetManipulations", "dungeonEnvironmentTemplates")}, "mappingReport": report}
    profile["contentRevision"] = calculate_revision(profile)
    return profile


def write_json(path, value, replace=False):
    if path.exists() and not replace: raise FileExistsError(f"Refusing to overwrite {path}; use --replace for generated artifacts")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
        handle.write("\n")
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decoded-dir", type=Path, required=True)
    parser.add_argument("--world", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    manifest, decoded = read_decoded(args.decoded_dir)
    world = json.loads(args.world.read_text())
    profile = build_profile(world, decoded, manifest)
    write_json(args.output, profile, args.replace)
    if args.report: write_json(args.report, {"profileRevision": profile["contentRevision"], **profile["mappingReport"]}, args.replace)
    print(json.dumps({"output": str(args.output), "contentRevision": profile["contentRevision"], "counts": profile["mappingReport"]["counts"]}, indent=2))

if __name__ == "__main__": main()
