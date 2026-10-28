#!/usr/bin/env python3
"""Export bounded, reproducible geometry using build 3640684's pure functions.

Only selected code objects from the common component are evaluated. The client
module, native extensions and game services are never imported or launched.
Use Python 3.12, the bytecode version of this specific client archive.
"""
import argparse
import hashlib
import json
import marshal
import math
from pathlib import Path
import random
import sys
import types
import zipfile
import zlib

ARCHIVE_SHA256 = "2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c"
MEMBER = "spacecomponents/common/components/compositeasteroid.pyc"
CLIENT_MEMBER = "spacecomponents/client/components/compositeasteroid.pyc"
BASE_RECIPE = {"archetype": "differentiated", "dim": 17, "radius": 6.0,
               "noise": 1.6, "prefix": "base"}
SEEDS = (3640684, 3640685, 3640686, 3640687)


def load_geometry(archive):
    if sys.version_info[:2] != (3, 12):
        raise ValueError("The build-3640684 oracle requires Python 3.12")
    raw = Path(archive).read_bytes()
    if hashlib.sha256(raw).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("Archive is not the verified build-3640684 code.ccp")
    with zipfile.ZipFile(archive) as source:
        code = marshal.loads(source.read(MEMBER)[16:])
    names = {"build_grid", "_shape_sphere", "_rot_matrix", "_plan_layers",
             "_layer_index", "_place_profiled", "_profile_from_type_recipe",
             "_recipe_to_derived", "_pick_shape", "_weight_pair",
             "apply_mined_blob", "mined_blob", "_ray_aabb", "_voxel_lattice",
             "_lattice_ray", "_walk_cells", "raymarch_voxel_hit"}
    scope = {"math": math, "random": random, "zlib": zlib,
             "_vhash_cache": {}, "_grid_cache": {}, "_JITTER": 0.03,
             "_ELONG_SALT": 2654435769, "_TWO_PI": math.pi * 2,
             "_DEFORM_FNS": {}, "_lattice_cache": {}}
    for obj in code.co_consts:
        if isinstance(obj, types.CodeType) and obj.co_name in names:
            scope[obj.co_name] = types.FunctionType(obj, scope)
    missing = names - scope.keys()
    if missing:
        raise ValueError(f"Expected client functions missing: {missing}")
    scope["_SHAPE_FNS"] = {name: scope["_shape_sphere"] for name in ("differentiated", "cutaway")}
    scope["_CUTAWAY"] = {"differentiated": False, "cutaway": True}
    scope["_walk_cells"].__defaults__ = (0.0,)
    return scope


def build_template(scope, seed, material="feldspar", type_id=1):
    recipe = {**BASE_RECIPE, "seed": seed, "spacing": 35.0, "radius_scale": 1.0,
              "layers": [{"depthLo": 0.0, "depthHi": 1.0, "materials": [
                  {"material": material, "typeID": type_id, "weight": 1.0,
                   "morphology": "massive", "self_affinity": 0.0}]}]}
    shape, dim, radius, spacing, noise, actual_seed, profile, scale = scope["_recipe_to_derived"](recipe, 1)
    grid = scope["build_grid"](shape, dim, radius, noise, actual_seed, profile, "base", None)
    if not grid or len(grid) > 32768 or any(c[3] != material for c in grid):
        raise ValueError("Client did not produce the expected bounded uniform material grid")
    return recipe, grid


def verify_client_contract(archive, recipe, blob):
    """Run original fetch/notice code with inert service and rendering stand-ins."""
    with zipfile.ZipFile(archive) as source:
        root = marshal.loads(source.read(CLIENT_MEMBER)[16:])
    functions = {}
    def collect(code):
        functions[code.co_qualname] = code
        for const in code.co_consts:
            if isinstance(const, types.CodeType):
                collect(const)
    collect(root)
    calls = []
    service = types.SimpleNamespace(
        GetCompositeRecipe=lambda item_id: (calls.append(("recipe", item_id)), recipe)[1],
        GetCompositeMinedSet=lambda item_id: (calls.append(("mined", item_id)), blob)[1])
    def remote(name):
        assert name == "compositeAsteroidMgr"
        return service
    scope = {"_recipe_by_item": {}, "sm": types.SimpleNamespace(RemoteSvc=remote),
             "remove_voxel": lambda *args: calls.append(("remove", *args))}
    fetch = types.FunctionType(functions["_fetch_recipe"], scope)
    fetch_mined = types.FunctionType(functions["CompositeAsteroid._fetch_mined_set"], scope)
    removed = types.FunctionType(functions["CompositeAsteroid.OnCompositeVoxelMined"], scope)
    changed = types.FunctionType(functions["CompositeAsteroid.OnCompositeMinedSetChanged"], scope)
    fake = types.SimpleNamespace(_item_id=1234, _vol_tex=None, _cell_by_index={},
                                 _child_by_grid_index={}, _container=None,
                                 _rebuild_visuals=lambda: calls.append(("rebuild",)))
    assert fetch(1234) == recipe
    assert fetch_mined(fake) == blob
    removed(fake, 1234, 42)
    removed(fake, 1235, 42)
    changed(fake, 1234)
    changed(fake, 1235)
    assert calls == [("recipe", 1234), ("mined", 1234), ("remove", 1234, 42), ("rebuild",)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--verify-input", type=Path,
                        help="JSON {recipe, cells, minedIndices, blobBase64} emitted by server test")
    args = parser.parse_args()
    scope = load_geometry(args.archive)
    if args.verify_input:
        import base64
        request = json.loads(args.verify_input.read_text())
        recipe = request["recipe"]
        shape, dim, radius, spacing, noise, seed, profile, scale = scope["_recipe_to_derived"](recipe, 1)
        grid = scope["build_grid"](shape, dim, radius, noise, seed, profile, recipe.get("prefix"), None)
        assert [list(cell) for cell in grid] == request["cells"], "Server/client cell indices differ"
        blob = base64.b64decode(request["blobBase64"]) if request["blobBase64"] else None
        count = scope["apply_mined_blob"](grid, blob, None)
        removed = [i for i, cell in enumerate(grid) if cell is None]
        assert removed == sorted(request["minedIndices"]), "Client mined-set decoder disagrees"
        scope["_grid_cache"][1] = (grid, spacing)
        scope["grid_and_spacing_for_item"] = lambda type_id, item_id: scope["_grid_cache"].get(item_id)
        for ray in request.get("raycasts", []):
            index, distance = scope["raymarch_voxel_hit"](1, 1, ray["origin"], ray["direction"])
            assert index == ray["index"], f"Client ray hit {index}, server hit {ray['index']}"
            if index is not None:
                assert math.isclose(distance, ray["distance"], abs_tol=1e-7), "Client ray distance differs"
        own_blob = scope["mined_blob"](1)
        assert (zlib.decompress(own_blob) if own_blob else None) == (zlib.decompress(blob) if blob else None)
        verify_client_contract(args.archive, recipe, blob)
        print(json.dumps({"clientBuild": 3640684, "cellCount": len(grid), "removedCount": count,
                          "decodedIndices": removed, "archiveSHA256": ARCHIVE_SHA256}))
        return
    if args.out is None:
        parser.error("--out or --verify-input is required")
    result = {"format": "evejs-frontier-composite-templates-v1", "clientBuild": 3640684,
              "archiveSHA256": ARCHIVE_SHA256, "member": MEMBER,
              "recipe": BASE_RECIPE, "templates": []}
    for seed in SEEDS:
        _, grid = build_template(scope, seed)
        result["templates"].append({"seed": seed, "cells": [list(c[:3]) for c in grid]})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(json.dumps({"output": str(args.out), "cells": [len(t["cells"]) for t in result["templates"]]}))


if __name__ == "__main__":
    main()
