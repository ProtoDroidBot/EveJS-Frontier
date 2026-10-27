#!/usr/bin/env python3
"""Compose canonical3572727 placements with compatible3640684 content catalogs.

Every source is fingerprinted. SQLite is used ONLY to prove older authored
parent identity; it never supplies replacement geography. Unknown anchors stay
unresolved while all source site IDs and absolute positions remain unchanged.
"""
from __future__ import annotations
import argparse
import copy
import csv
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sqlite3
from collections import Counter

_spec = importlib.util.spec_from_file_location("legacy_landscape", Path(__file__).with_name("build-temporary-landscape-world.py"))
legacy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(legacy)
positive, number, vector, entries, index = legacy.positive, legacy.number, legacy.vector, legacy.entries, legacy.index
normalize_dungeon, normalize_ecosystem = legacy.normalize_dungeon, legacy.normalize_ecosystem
calculate_revision, MARKERS = legacy.calculate_revision, legacy.MARKERS
FORMAT = "evejs-frontier-landscape-content-v1"
PROFILE = "3572727-geography-3640684-content-v1"
WORLD_LABEL = "3572727-CANONICAL-FSD"
WORLD_PROFILE = "3572727-canonical-fsd-v1"
CONVERSION_POLICY = "canonical-landscape-3572727-catalog-3640684-v1"
ANCHOR_POLICY = "strict-physical-identity-v1"
ARCHIVE_SHA256 = "eee139e55d95d75e897eb944c8045fb9ee1ef1b86a8672c2f453e1fffcde9f89"
PLACEMENT_SHA256 = "c45f205a152b8786d8b767629913d7c8cd8dd78a3f631e8ab3480e893d0d85db"
PLACEMENT_DECODED_SHA256 = "a034fcaa6fa0dcb53d6cb0eab11c58e831874a58c93a44c9297f4707e51c34cf"
DB_SHA256 = "989883f198c92df9780b0d771ef3c93764c4559b46cf7c059733a02d7c389f3a"
CATALOG_OUTPUT_SHA256 = {
    "dungeonAssetManipulations": "08771cae10cc3a342633010e74f57933f464f4769362b661bab8a39f7a9bd375",
    "dungeonEnvironmentTemplates": "1237d7c37c8449853fa3c62f95a7129862234dad342849dcc29dc2f8a5d568ff",
    "dungeons": "d80318590dcffe6bffeafbb312960c8e12a111e13fdb3fba9313cb74cede170d",
    "ecosystem": "56a8a5f519732450ae0afa89386772353e17635c4a3608b0156992e2c90c02d4",
    "landscape": "f4d7ff54463629f1a98f50a069b85d155322340d811171441807f2bed0d491b6",
    "referencedTypes": "a4502c1568feae8bc8eaa10b995a20a201950d8246b73f3b4d59827451ef290f",
}


def fingerprint(path):
    h, md5 = hashlib.sha256(), hashlib.md5()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            h.update(block); md5.update(block)
    return {"sha256": h.hexdigest(), "md5": md5.hexdigest(), "bytes": path.stat().st_size}


def read_placement(placement_dir):
    placement_dir = placement_dir.resolve()
    source = json.loads((placement_dir / "manifest.json").read_text())
    if source.get("build") != 3572727 or source.get("errors"):
        raise ValueError("Expected successful exact3572727 placement export")
    info = source["outputs"]["landscape"]
    if info["sha256"] != PLACEMENT_DECODED_SHA256:
        raise ValueError("Unsupported3572727 decoded landscape fingerprint")
    relative = Path(info.get("path", "landscape.jsonl"))
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("3572727 decoded landscape path escapes its export directory")
    path = (placement_dir / relative).resolve()
    if not path.is_relative_to(placement_dir):
        raise ValueError("3572727 decoded landscape symlink escapes its export directory")
    digest = fingerprint(path)
    if digest["sha256"] != info["sha256"] or digest["bytes"] != info["bytes"]:
        raise ValueError("3572727 decoded landscape integrity mismatch")
    rows = [json.loads(line) for line in path.open() if line.strip()]
    if len(rows) != info["rows"]:
        raise ValueError("3572727 landscape row count differs")
    return rows, info


def read_inputs(catalog_dir, placement_dir, client_root):
    manifest, decoded = legacy.read_decoded(catalog_dir)
    for name, digest in CATALOG_OUTPUT_SHA256.items():
        if manifest["outputs"][name]["sha256"] != digest:
            raise ValueError(f"Unsupported compatible3640684 decoded output: {name}")
    rows, info = read_placement(placement_dir)
    archive = fingerprint(client_root / "stillness/code.ccp")
    if archive["sha256"] != ARCHIVE_SHA256:
        raise ValueError("3572727 source archive fingerprint differs")
    with (client_root / "stillness/resfileindex.txt").open(newline="") as stream:
        indexed = {row[0].lower(): row for row in csv.reader(stream)}
    raw = indexed["res:/staticdata/landscape.fsdbinary"]
    physical = (client_root / "ResFiles" / raw[1]).resolve()
    if not physical.is_relative_to((client_root / "ResFiles").resolve()):
        raise ValueError("Landscape cache path escapes the selected source")
    raw_digest = fingerprint(physical)
    if raw_digest["sha256"] != PLACEMENT_SHA256 or raw_digest["md5"] != raw[2] or raw_digest["bytes"] != int(raw[3]):
        raise ValueError("3572727 raw landscape differs from pinned input/index")
    database = client_root / "stillness/bin64/staticdata/mapObjects.db"
    if fingerprint(database)["sha256"] != DB_SHA256:
        raise ValueError("Older-snapshot diagnostic database fingerprint differs")
    metadata = {"build": 3572727, "archiveSHA256": ARCHIVE_SHA256,
                "files": {"landscape": {**raw_digest, "logicalPath": raw[0], "cachePath": raw[1]}},
                "decodedOutput": {**info, "path": "landscape.jsonl"}}
    decoded["baselineLandscape"] = decoded["landscape"]
    decoded["landscape"] = rows
    return manifest, decoded, metadata, database


def derive_safe_parent_ids(world, diagnostic_rows):
    """Exact old physical identity; never use ordinals or proximity as identity."""
    safe = set()
    for system in world["systems"]:
        local = [(sun, 6, None) for sun in [system.get("sun"), system.get("secondarySun"), *system.get("companionSuns", [])] if sun]
        for planet in system.get("planets", []):
            local.append((planet, 7, None))
            local.extend((moon, 8, planet["id"]) for moon in planet.get("moons", []))
            local.extend((point, 4870, planet["id"]) for point in planet.get("lagrangePoints", []))
        for obj, group, parent in local:
            old = diagnostic_rows(obj["id"])
            if not old or old["solarSystemID"] != system["id"] or old["groupID"] != group or old["typeID"] != obj["typeId"]:
                continue
            if [old[axis] for axis in "xyz"] != [obj["position"][axis] for axis in "xyz"]:
                continue
            if group == 4870:
                if old.get("orbitID") != parent:
                    continue
            elif old.get("radius") != obj.get("radiusM"):
                continue
            safe.add(obj["id"])
    return safe


def build_profile(world, decoded, manifest, placement_metadata, diagnostic_rows):
    if (world.get("format") != "evejs-frontier-exploration-world-v1" or
            world.get("source", {}).get("label") != WORLD_LABEL or
            world.get("source", {}).get("build") != 3572727 or world.get("targetBuild") != 3640684):
        raise ValueError("Select the canonical 3572727 exploration world for client 3640684")
    if calculate_revision(world) != world.get("contentRevision"):
        raise ValueError("Selected world content revision mismatch")
    if (world["source"].get("profile") != WORLD_PROFILE or
            world["source"].get("kind") != "canonical-client-geography"):
        raise ValueError("Canonical source profile is required")
    systems = index(world["systems"], "system", "id")
    original_landscapes = index(decoded["baselineLandscape"], "baseline landscape system")
    shared = set(original_landscapes) & {row["_key"] for row in decoded["landscape"]}
    for row in decoded["landscape"]:
        if row["_key"] in shared and row != original_landscapes[row["_key"]]:
            raise ValueError(f"Shared landscape row {row['_key']} differs from the proven older snapshot")
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
    safe_ids = derive_safe_parent_ids(world, diagnostic_rows)
    def admitted(system_id, object_id):
        return object_id in anchors[system_id] and (system_id not in shared or object_id in safe_ids)
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
                unresolved = {name: value for name, value in source_anchors.items() if not admitted(system_id, value)}
                if kind == "trojan":
                    planet = planets[system_id].get(feature.get("planetID"))
                    if not planet or feature.get("lagrangePointID") not in {p["id"] for p in planet.get("lagrangePoints", [])}:
                        unresolved.update({"planetID": feature.get("planetID"), "lagrangePointID": feature.get("lagrangePointID")})
                if kind == "asteroidBelt":
                    if not source_anchors:
                        counts["unreferencedBelts"] += 1
                    elif not unresolved:
                        counts["fullyProvenReferencedBelts"] += 1
                elif not unresolved:
                    counts["fullyProvenTrojans"] += 1
                if unresolved:
                    counts["featuresWithUnmappedAnchors"] += 1
                    reports.append({"systemID": system_id, "featureID": feature_id, "featureKind": kind,
                                    "reason": "SOURCE_ANCHOR_PHYSICAL_IDENTITY_NOT_PROVEN", "references": unresolved})
                source_feature = {"systemID": system_id, "featureID": feature_id, "featureKind": kind,
                                  "sourceAnchors": source_anchors, "unmappedAnchors": unresolved,
                                  "placementSnapshot": "shared-older-snapshot" if system_id in shared else "canonical-fsd-snapshot"}
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
                        "spawnEnabled": bool(ecosystem.get("spawnEnabled", True)), "placementSourceBuild": 3572727, **MARKERS})
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
                    if center_id and not admitted(system_id, center_id):
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
                        if value and value in allowed and admitted(system_id, value): belt[target_name] = value
                        elif value and value in anchors[system_id] and admitted(system_id, value):
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
    counts["strictSafeParentIDs"] = len(safe_ids)
    counts["sharedLandscapeSystems"] = len(shared)
    counts["newCanonicalLandscapeSystems"] = len(landscapes) - len(shared)
    report = {"counts": dict(counts), "coordinatePolicy": "preserve-authored-system-local-metres",
        "systemMapping": "exact-source-system-id-in-selected-world",
        "anchorPolicy": "strict-physical-old-parent-identity; canonical-new-row-membership; preserve-scene-origins",
        "derivedMapPositions": {"beltClusters": "client midpoint-radius/mean-arc formula", "trojans": "control-point centroid; mean authored cluster midpoint"},
        "unmapped": reports, "sourceFeatureMappings": source_feature_records}
    profile = {"format": FORMAT, "temporary": False, "profile": PROFILE, "targetBuild": 3640684,
        "conversionPolicyRevision": CONVERSION_POLICY, "anchorPolicyRevision": ANCHOR_POLICY,
        "source": {"build": 3640684, "files": manifest["files"], "decodedOutputs": manifest["outputs"], "decoder": manifest.get("decoder"), "placements": placement_metadata},
        "world": {"label": WORLD_LABEL, "sourceProfile": WORLD_PROFILE, "revision": world["contentRevision"]},
        "anchorProof": {"policy": ANCHOR_POLICY, "worldRevision": world["contentRevision"], "diagnosticDatabaseSHA256": DB_SHA256},
        "contentRevisionAlgorithm": "sha256-typed-f64-v1", "systems": patches,
        "tables": {"landscapeSites": {"sites": sites}, "landscapeEcosystems": {"ecosystems": list(ecosystems.values())},
            "landscapeDungeonTemplates": {"dungeons": list(dungeons.values())}, "frontierDungeonTemplates": {"dungeons": list(dungeons.values())},
            "itemTypes": {"types": [{**row, **MARKERS} for row in types.values()]}},
        "supportingData": {name: decoded[name] for name in ("dungeonAssetManipulations", "dungeonEnvironmentTemplates")}, "mappingReport": report}
    profile["contentRevision"] = calculate_revision(profile)
    return profile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world", type=Path, required=True)
    parser.add_argument("--catalog-decoded", type=Path, required=True)
    parser.add_argument("--placement-decoded", type=Path, required=True)
    parser.add_argument("--client-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    for output in [args.output, *([args.report] if args.report else [])]:
        if output.exists():
            parser.error(f"Refusing to overwrite existing output: {output}")
        if output.resolve().is_relative_to(args.client_root.resolve()):
            parser.error("Output must not modify the source client")
    manifest, decoded, metadata, database = read_inputs(args.catalog_decoded, args.placement_decoded, args.client_root)
    world = json.loads(args.world.read_text())
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        db.row_factory = sqlite3.Row
        def lookup(object_id):
            row = db.execute("SELECT * FROM celestials WHERE celestialID=?", (object_id,)).fetchone()
            return dict(row) if row is not None else None
        profile = build_profile(world, decoded, manifest, metadata, lookup)
    legacy.write_json(args.output, profile)
    if args.report:
        legacy.write_json(args.report, {"profileRevision": profile["contentRevision"], **profile["mappingReport"]})
    print(json.dumps({"output": str(args.output), "contentRevision": profile["contentRevision"], "counts": profile["mappingReport"]["counts"]}, indent=2))


if __name__ == "__main__":
    main()
