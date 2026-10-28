#!/usr/bin/env python3
"""Decode exact 3640684 landscape resources with the client's native readers.

Run with 64-bit Windows CPython 3.12, directly or in a disposable Wine prefix.
Only the output directory is written. The game itself is never launched.
"""
from __future__ import annotations

import argparse
import configparser
import csv
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import pickle
import struct
import sys

BUILD = 3640684
ARCHIVE_SHA256 = "2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c"
TABLES = {
    "landscape": ("landscapeLoader", "96294eb01a11a06fdb1c5a7c12a25c58"),
    "ecosystem": ("ecosystemLoader", "182f93f9a5c4fd59ab5f3bdc3a5283db"),
    "dungeons": ("dungeonsLoader", "544a23942315f2165465483ca0ef60df"),
    "dungeonAssetManipulations": ("dungeonAssetManipulationsLoader", "d804772c79ef16931e9efaa1059356a7"),
    "dungeonEnvironmentTemplates": ("dungeonEnvironmentTemplatesLoader", "8d415c94344a98591346a32fd956a7e1"),
}
INVENTORY_TYPE_FIELDS = {"typeid", "entrytypeid", "basecloudtypeid", "beacontypeid", "postprocesstypeid", "lootdroptypeid"}


class DataOnlyUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        raise ValueError(f"Localization cannot load global {module}.{name}")


def digest(path, algorithm="sha256"):
    value = hashlib.new(algorithm)
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def normalize(value, *, depth=0):
    """Export every public native data attribute; unreadable values fail closed."""
    if depth > 80:
        raise ValueError("Native data exceeds maximum nesting")
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Nonfinite native number")
        return value
    if isinstance(value, bytes):
        return {"$bytes": value.hex()}
    child = lambda item: normalize(item, depth=depth + 1)
    if callable(getattr(value, "keys", None)):
        result = {}
        for key in value.keys():
            if not isinstance(key, (str, int)) or isinstance(key, bool):
                raise TypeError(f"Unsupported native mapping key: {key!r}")
            text = str(key)
            if text in result:
                raise ValueError("Native key stringification collision")
            result[text] = child(value[key])
        return result
    if isinstance(value, (set, frozenset)):
        values = [child(item) for item in value]
        return {"$frozenset" if isinstance(value, frozenset) else "$set": sorted(values, key=lambda x: json.dumps(x, sort_keys=True))}
    if isinstance(value, (list, tuple)) or (hasattr(value, "__iter__") and hasattr(value, "__len__")):
        return [child(item) for item in value]
    result = {}
    for name in dir(value):
        if name.startswith("_"):
            continue
        item = getattr(value, name)
        if not callable(item):
            result[name] = child(item)
    if result or type(value).__module__.endswith("Loader"):
        return result
    raise TypeError(f"Unsupported native value {type(value).__module__}.{type(value).__name__}")


def resource_index(root):
    result = {}
    for index in (root / "index_stillness.txt", root / "stillness" / "resfileindex.txt"):
        with index.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.reader(stream):
                if len(row) >= 4:
                    result[row[0].lower()] = row
    return result


def verify_resource(root, index, logical, fingerprint=None):
    entry = index.get(logical.lower())
    if entry is None:
        raise ValueError(f"Resource is not indexed: {logical}")
    resource = root / "ResFiles" / entry[1]
    if not resource.is_file() or resource.stat().st_size != int(entry[3]):
        raise ValueError(f"Resource missing or length differs: {logical}")
    if digest(resource, "md5") != entry[2]:
        raise ValueError(f"Resource hash differs: {logical}")
    metadata = {"logicalPath": logical, "cachePath": entry[1], "bytes": resource.stat().st_size, "md5": entry[2], "sha256": digest(resource)}
    if logical.endswith(".fsdbinary"):
        with resource.open("rb") as stream:
            header = stream.read(56)
        if len(header) != 56 or struct.unpack_from("<Q", header, 24)[0] != resource.stat().st_size - 32:
            raise ValueError(f"Invalid cFSD header: {logical}")
        metadata["schemaFingerprint"] = header[:16].hex()
        metadata["declaredRootRows"] = struct.unpack_from("<Q", header, 40)[0]
        if fingerprint and metadata["schemaFingerprint"] != fingerprint:
            raise ValueError(f"Unexpected build schema: {logical}")
    return resource, metadata


def write_rows(path, rows):
    temporary = path.with_name(path.name + ".tmp")
    count = 0
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as stream:
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n")
                count += 1
        temporary.replace(path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return {"path": path.name, "rows": count, "sha256": digest(path), "bytes": path.stat().st_size}


def referenced_type_ids(value):
    found = set()
    def visit(item):
        if isinstance(item, dict):
            for key, child in item.items():
                # Archetype, eventTypeID and triggerTypeID are enum/domain IDs,
                # not inventory types. Do not manufacture missing type errors.
                if key.lower() in INVENTORY_TYPE_FIELDS and isinstance(child, int) and not isinstance(child, bool) and child > 0:
                    found.add(child)
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)
    visit(value)
    return found


def export(root, output):
    if os.name != "nt" or sys.version_info[:2] != (3, 12) or struct.calcsize("P") != 8:
        raise RuntimeError("Requires 64-bit Windows CPython 3.12 (native or disposable Wine worker)")
    ini = configparser.ConfigParser(); ini.read(root / "stillness" / "start.ini", encoding="utf-8-sig")
    if int(ini["main"]["build"]) != BUILD:
        raise ValueError("Requires exact client build 3640684")
    if digest(root / "stillness" / "code.ccp") != ARCHIVE_SHA256:
        raise ValueError("Unexpected code.ccp fingerprint")
    index = resource_index(root)
    bin_root = root / "stillness" / "bin64"
    dll_handle = os.add_dll_directory(str(bin_root))
    sys.path.append(str(bin_root))
    output.mkdir(parents=True, exist_ok=True)
    manifest = {"format": "evejs-frontier-landscape-native-v1", "build": BUILD, "archiveSHA256": ARCHIVE_SHA256,
                "decoder": {"method": "exact-client-native-loaders", "python": sys.version, "bits": 64}, "files": {}, "outputs": {}}
    references = set()
    for table, (loader_name, fingerprint) in TABLES.items():
        physical, metadata = verify_resource(root, index, f"res:/staticdata/{table.lower()}.fsdbinary", fingerprint)
        loader, loader_meta = verify_resource(root, index, f"app:/bin64/{loader_name}.pyd")
        installed = bin_root / (loader_name + ".pyd")
        if digest(installed) != loader_meta["sha256"]:
            raise ValueError(f"Installed loader differs from indexed loader: {loader_name}")
        metadata["loader"] = loader_meta
        manifest["files"][table] = metadata
        rows = importlib.import_module(loader_name).load(str(physical))
        if len(rows) != metadata["declaredRootRows"]:
            raise ValueError(f"Decoded root count differs: {table}")
        def records():
            for key in sorted(rows.keys()):
                value = normalize(rows[key])
                if not isinstance(value, dict) or "_key" in value:
                    raise ValueError(f"Unexpected {table} root row")
                references.update(referenced_type_ids(value))
                yield {"_key": key, **value}
        manifest["outputs"][table] = write_rows(output / (table + ".jsonl"), records())
        print(f"Decoded {table}: {manifest['outputs'][table]['rows']} rows", flush=True)
    loaded = {}
    for table, loader_name in (("types", "typesLoader"), ("groups", "groupsLoader"), ("spaceComponentsByType", "spaceComponentsByTypeLoader"), ("typeDogma", "typeDogmaLoader")):
        physical, metadata = verify_resource(root, index, f"res:/staticdata/{table.lower()}.fsdbinary")
        _, loader_meta = verify_resource(root, index, f"app:/bin64/{loader_name}.pyd")
        if digest(bin_root / (loader_name + ".pyd")) != loader_meta["sha256"]:
            raise ValueError(f"Installed loader differs: {loader_name}")
        metadata["loader"] = loader_meta; manifest["files"][table] = metadata
        loaded[table] = importlib.import_module(loader_name).load(str(physical))
    localization_path, localization_meta = verify_resource(root, index, "res:/localizationfsd/localization_fsd_en-us.pickle")
    manifest["files"]["localization"] = localization_meta
    with localization_path.open("rb") as stream:
        localization = DataOnlyUnpickler(stream, encoding="bytes").load()[1]
    missing = []
    def type_rows():
        for key in sorted(references):
            value = loaded["types"].get(key)
            if value is None:
                missing.append(key); continue
            row = normalize(value)
            group = loaded["groups"].get(row["groupID"])
            if group is None:
                raise ValueError(f"Type {key} references unknown group {row['groupID']}")
            name = localization.get(row.get("typeNameID"), (None,))[0]
            yield {"_key": key, **row, "categoryID": group.categoryID,
                   "name": name or f"Type {key}", "nameFallback": not bool(name),
                   "spaceComponents": normalize(loaded["spaceComponentsByType"].get(key)),
                   "dogma": normalize(loaded["typeDogma"].get(key))}
    manifest["outputs"]["referencedTypes"] = write_rows(output / "referencedTypes.jsonl", type_rows())
    manifest["referencedTypeIDs"] = sorted(references)
    manifest["unresolvedTypeIDs"] = missing
    # A manifest only appears after every requested table succeeds.
    temporary = output / "manifest.json.tmp"
    temporary.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(output / "manifest.json")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    export(args.client_root.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
