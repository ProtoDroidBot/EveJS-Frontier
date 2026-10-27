#!/usr/bin/env python3
"""Export exact3640684 native catalogs, excluding every geography table.

Uses the existing dump_frontier_static normalizer in isolated Windows CPython
3.12 under Bottles/Wine. Clients and the interpreter are mounted read-only.
No game, legacy geography extractor or live database is started.
"""
from __future__ import annotations
import argparse
import configparser
import csv
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pickle
import struct
import subprocess
import sqlite3
import sys
import tempfile

ARCHIVE_SHA = "2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c"


def fingerprint(path):
    sha, md5 = hashlib.sha256(), hashlib.md5()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1048576), b""):
            sha.update(block); md5.update(block)
    return {"sha256": sha.hexdigest(), "md5": md5.hexdigest(), "size": path.stat().st_size}


class DataOnlyUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        raise ValueError(f"Localization cannot load {module}.{name}")


def worker(root, out):
    if os.name != "nt" or sys.version_info[:2] != (3, 12) or struct.calcsize("P") != 8:
        raise ValueError("Native export requires Windows64 CPython3.12")
    sys.dont_write_bytecode = True
    for source in (root.resolve(), Path(sys.executable).resolve().parent, Path(__file__).resolve().parent):
        if out.resolve().is_relative_to(source) or source.is_relative_to(out.resolve()):
            raise ValueError("Catalog output must not overlap source/runtime/helper inputs")
    ini = configparser.ConfigParser(); ini.read(root / "stillness/start.ini", encoding="utf-8-sig")
    if ini.getint("main", "build") != 3640684 or fingerprint(root / "stillness/code.ccp")["sha256"] != ARCHIVE_SHA:
        raise ValueError("Requires exact unmodified3640684 source")
    index = {}
    for name in (root / "index_stillness.txt", root / "stillness/resfileindex.txt"):
        with name.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.reader(f):
                index[row[0].lower()] = row
    inputs = {}

    def verified(logical):
        row = index[logical.lower()]
        p = root / "ResFiles" / row[1]
        if ".." in Path(row[1]).parts or Path(row[1]).is_absolute():
            raise ValueError("Unsafe indexed cache path")
        value = fingerprint(p)
        if value["md5"] != row[2] or value["size"] != int(row[3]):
            raise ValueError(f"Resource differs from indexed source: {logical}")
        inputs[logical] = {**value, "cachePath": row[1]}
        return p

    spec = importlib.util.spec_from_file_location("catalog_normalizer", Path(__file__).with_name("dump_frontier_static.py"))
    dump = importlib.util.module_from_spec(spec); spec.loader.exec_module(dump)
    # Native Frontier recipes differ from EVE's activities-based blueprints.
    # Retain their exact columns under distinct names; do not reinterpret them.
    dump.NATIVE_TABLES = (*dump.NATIVE_TABLES,
        ("frontierIndustryBlueprints", "industry_blueprintsLoader", "frontierIndustryBlueprints.jsonl"),
        ("frontierIndustryFacilities", "industry_facilitiesLoader", "frontierIndustryFacilities.jsonl"))
    binroot = root / "stillness/bin64"
    handle = os.add_dll_directory(str(binroot))
    sys.path.append(str(binroot))
    request = {"client": dict(ini["main"]), "resources": {}}
    for key, module, filename in dump.NATIVE_TABLES:
        logical = "res:/staticdata/" + module[:-6].lower() + ".fsdbinary"
        request["resources"][key] = {"physicalPath": str(verified(logical))}
        cached = verified("app:/bin64/" + module + ".pyd")
        installed = binroot / (module + ".pyd")
        if fingerprint(installed)["sha256"] != fingerprint(cached)["sha256"]:
            raise ValueError("Installed loader differs from indexed native source")
    localization = verified("res:/localizationfsd/localization_fsd_en-us.pickle")
    with localization.open("rb") as f:
        language, messages = DataOnlyUnpickler(f).load()
    if not isinstance(messages, dict):
        raise ValueError("Unexpected localization payload")
    out.mkdir(parents=True, exist_ok=True)
    report = {"format": "evejs-compatible-native-catalogs-v1", "build": 3640684,
              "archiveSHA256": ARCHIVE_SHA, "method": "Exact client native loaders; no geography export, game or database process",
              "localizationLanguage": language, "localizationMessages": len(messages), "outputs": {}}
    dump.install_blue_stub()
    dump.export_native_tables(request, str(out), messages, report)
    # This .static resource is actually a SQLite JSON cache, not binary FSD.
    dbuff = verified("res:/staticdata/dbuffcollections.static")
    with sqlite3.connect(dbuff.as_uri() + "?mode=ro&immutable=1", uri=True) as connection:
        def dbuff_rows():
            for key, value in connection.execute("SELECT key,value FROM cache ORDER BY CAST(key AS INTEGER)"):
                row = json.loads(value)
                if not str(key).isdigit() or not isinstance(row, dict):
                    raise ValueError("Unexpected DBuff JSON cache row")
                yield {**row, "_key": int(key)}
        report["outputs"]["dbuffCollections.jsonl"] = dump.write_jsonl(str(out), "dbuffCollections.jsonl", dbuff_rows())
    for name, rows in list(report["outputs"].items()):
        report["outputs"][name] = {"rows": rows, **fingerprint(out / name)}
        print(name, rows, flush=True)
    report["inputs"] = inputs
    report["catalogScope"] = {"nativeTables": len(dump.NATIVE_TABLES), "sqliteJsonTables": 1,
        "industryPolicy": "Raw verified native Frontier recipes/facilities retained; existing runtime industry selection unchanged; no EVE activities conversion"}
    (out / "manifest.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"build": 3640684, "tables": len(report["outputs"]), "outputs": report["outputs"]}), flush=True)


def windows(path):
    return "Z:" + str(path.resolve()).replace("/", "\\")


def run(args):
    root, out, runtime, runner = (p.resolve() for p in (args.client_root, args.out, args.python_runtime, args.runner))
    for p in (root, runtime, runner.parent.parent):
        if out.is_relative_to(p) or p.is_relative_to(out):
            raise ValueError("Output must not overlap protected inputs")
    if out.exists() and any(out.iterdir()):
        raise FileExistsError("Catalog output must be new or empty")
    out.mkdir(parents=True, exist_ok=True)
    script = Path(__file__).resolve()
    with tempfile.TemporaryDirectory(prefix="evejs-compatible-catalogs-") as temp:
        workspace = Path(temp)
        base = ["flatpak", "run", "--command=env", "--filesystem=" + temp,
                "--filesystem=" + str(root) + ":ro", "--filesystem=" + str(runtime) + ":ro",
                "--filesystem=" + str(runner.parent.parent) + ":ro", "--filesystem=" + str(script.parent) + ":ro",
                "--filesystem=" + str(out), "com.usebottles.bottles", "-u", "WINELOADER", "-u", "WINESERVER", "-u", "WINEDLLPATH",
                "WINEARCH=win64", "WINEPREFIX=" + str(workspace / "prefix"), "WINEDEBUG=-all", "WINEDLLOVERRIDES=winemenubuilder.exe=d"]
        try:
            return subprocess.run([*base, str(runner), str(runtime / "python.exe"), "-I", windows(script), "--worker", "--client-root", windows(root), "--out", windows(out)], check=False, timeout=args.timeout).returncode
        finally:
            for operation in ("-k", "-w"):
                subprocess.run([*base, str(runner.with_name("wineserver")), operation], timeout=15, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--client-root", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--python-runtime", type=Path)
    p.add_argument("--runner", type=Path)
    p.add_argument("--timeout", type=float, default=300)
    p.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = p.parse_args()
    if args.worker:
        worker(args.client_root, args.out); return 0
    if not args.python_runtime or not args.runner:
        p.error("--python-runtime and --runner are required")
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
