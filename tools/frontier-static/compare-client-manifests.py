#!/usr/bin/env python3
"""Read-only comparison of two installed client manifests and native files.

Uses only the Python standard library. No client module or executable is loaded.
Resource differences use indexed MD5 and size; installed app files are hashed.
"""
import argparse
import configparser
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path


def fingerprint(path):
    sha, md5 = hashlib.sha256(), hashlib.md5()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(block)
            md5.update(block)
    return {"bytes": path.stat().st_size, "sha256": sha.hexdigest(), "md5": md5.hexdigest()}


def index(path):
    entries = {}
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for number, row in enumerate(csv.reader(stream), 1):
            if not row:
                continue
            if len(row) not in (5, 6) or row[0] in entries:
                raise ValueError(f"Invalid/duplicate index entry {path}:{number}")
            logical, cache, md5, size, packed = row[:5]
            if not logical.startswith(("res:/", "app:/")):
                raise ValueError(f"Invalid logical path {logical}")
            if Path(cache).is_absolute() or ".." in Path(cache).parts:
                raise ValueError(f"Unsafe cache path {cache}")
            entries[logical] = {"cachePath": cache, "md5": md5, "bytes": int(size), "packedBytes": int(packed)}
    return entries


def compare(a, b, equal):
    common = a.keys() & b.keys()
    return {
        "baselineCount": len(a), "targetCount": len(b),
        "unchangedCount": sum(equal(a[k], b[k]) for k in common),
        "added": {k: b[k] for k in sorted(b.keys() - a.keys())},
        "removed": {k: a[k] for k in sorted(a.keys() - b.keys())},
        "changed": {k: {"baseline": a[k], "target": b[k]} for k in sorted(common) if not equal(a[k], b[k])},
    }


def inventory(root):
    ini = configparser.ConfigParser()
    ini.read(root / "stillness/start.ini", encoding="utf-8-sig")
    paths = ["index_stillness.txt", *["stillness/" + p for p in (
        "start.ini", "carbon.json", "code.ccp", "manifest.dat", "resfileindex.txt",
        "resfileindex_Windows.txt", "resfileindex_prefetch.txt")]]
    files = {p: fingerprint(root / p) for p in paths if (root / p).is_file()}
    binaries = {str(p.relative_to(root / "stillness/bin64")): fingerprint(p)
                for p in sorted((root / "stillness/bin64").rglob("*")) if p.is_file()}
    app = index(root / "index_stillness.txt")
    mismatches = []
    for name, entry in app.items():
        relative = name.removeprefix("app:/")
        local = root / "stillness" / relative
        if not local.is_file():
            mismatches.append({"logicalPath": name, "reason": "missing-installed-file"})
            continue
        actual = binaries.get(relative.removeprefix("bin64/")) if relative.startswith("bin64/") else files.get("stillness/" + relative)
        actual = actual or fingerprint(local)
        if (actual["md5"], actual["bytes"]) != (entry["md5"], entry["bytes"]):
            mismatches.append({"logicalPath": name, "indexed": entry, "actual": actual})
    return {"root": str(root), "startIni": dict(ini["main"]), "files": files, "bin64": binaries,
            "appIndex": app, "appIndexInstalledMismatches": mismatches,
            "resources": index(root / "stillness/resfileindex.txt"),
            "carbonLibraries": json.loads((root / "stillness/carbon.json").read_text())["libraries"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    baseline = inventory(args.baseline.resolve())
    target = inventory(args.target.resolve())
    result = {"format": "evejs-client-manifest-comparison-v1", "direction": "baseline-to-target",
              "method": "Resource deltas compare indexed MD5/size. Every installed bin64 file is SHA256/MD5 hashed; app-index installed hashes are checked. Resource payload hashes require separate verification.",
              "baseline": {k: v for k, v in baseline.items() if k not in ("resources", "appIndex")},
              "target": {k: v for k, v in target.items() if k not in ("resources", "appIndex")}}
    indexed_equal = lambda a, b: (a["md5"], a["bytes"]) == (b["md5"], b["bytes"])
    result["resources"] = compare(baseline["resources"], target["resources"], indexed_equal)
    result["appFiles"] = compare(baseline["appIndex"], target["appIndex"], indexed_equal)
    result["installedBin64"] = compare(baseline["bin64"], target["bin64"], lambda a, b: a["sha256"] == b["sha256"])
    result["carbonLibraries"] = compare(baseline["carbonLibraries"], target["carbonLibraries"], lambda a, b: a == b)
    for section in ("resources", "appFiles", "installedBin64", "carbonLibraries"):
        delta = result[section]
        counts = {k: len(delta[k]) for k in ("added", "removed", "changed")}
        counts.update({k: delta[k] for k in ("baselineCount", "targetCount", "unchangedCount")})
        print(section, json.dumps(counts, sort_keys=True), flush=True)
    groups = {}
    for kind in ("added", "removed", "changed"):
        groups[kind] = dict(Counter("/".join(p.split("/")[:3]) for p in result["resources"][kind]).most_common())
    result["resourceGroups"] = groups
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
