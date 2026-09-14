#!/usr/bin/env python3
"""Refresh the bundled Industry recipes with the client's Python 3.12 loaders.

Example (run with the repository's Frontier Python 3.12 environment):
  python tools/frontier-static/extract-industry-static.py \
    --client-root /path/to/client/build \
    --out server/src/services/frontier/industryStaticData.json

The build directory must contain start.ini, resfileindex.txt, code.ccp, and
bin64. ResFiles is resolved in that directory or its parent; --resfiles-root
can override the cache location. No network access or client changes occur.
"""

import argparse
import configparser
import importlib
import json
import os
from pathlib import Path
import sys

from dump_frontier_static import to_plain


RESOURCES = {
    "res:/staticdata/industry_blueprints.fsdbinary": "blueprints",
    "res:/staticdata/industry_facilities.fsdbinary": "facilities",
}


def read_build(client):
    config = configparser.ConfigParser()
    config.read(client / "start.ini", encoding="utf-8-sig")
    build = int(config["main"]["build"])
    if build <= 0 or config["main"].get("appname", "").upper() != "FRONTIER":
        raise ValueError("Expected a Frontier client build in start.ini")
    return build


def extract(client, cache):
    result = {"build": read_build(client), "sources": {}, "facilities": {}, "blueprints": {}}
    index = {}
    for line in (client / "resfileindex.txt").read_text(encoding="utf-8-sig").splitlines():
        fields = line.split(",")
        if fields[0].lower() in RESOURCES:
            index[fields[0].lower()] = fields
    for logical_path, target in RESOURCES.items():
        fields = index[logical_path]
        name = Path(logical_path).stem
        source = (cache / fields[1]).resolve()
        if not source.is_relative_to(cache.resolve()):
            raise ValueError(f"Resource path leaves ResFiles: {fields[1]}")
        loader = importlib.import_module(name + "Loader")
        table = loader.load(str(source))
        result[target] = {str(key): to_plain(table[key]) for key in sorted(table.keys())}
        result["sources"][name] = {"logicalPath": logical_path, "sourceHash": fields[2]}
    return result


def write_snapshot(result, destination):
    # Keep one authored row per line so changes remain reviewable and compact.
    lines = ["{", f'  "build": {result["build"]},',
             '  "sources": ' + json.dumps(result["sources"], separators=(",", ":")) + ","]
    for name in ("facilities", "blueprints"):
        lines.append(f'  "{name}": {{')
        lines.append(",\n".join(
            f'    "{key}": ' + json.dumps(value, separators=(",", ":"))
            for key, value in result[name].items()
        ))
        lines.append("  }," if name == "facilities" else "  }")
    lines.extend(["}", ""])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-root", required=True, type=Path)
    parser.add_argument("--resfiles-root", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        parser.error("Client native loaders require Python 3.12")
    client = args.client_root.resolve()
    cache = args.resfiles_root or next(
        (candidate for candidate in (client / "ResFiles", client.parent / "ResFiles")
         if candidate.is_dir()), None,
    )
    if cache is None:
        parser.error("Cannot locate ResFiles; supply --resfiles-root")
    bin64 = client / "bin64"
    sys.path.extend([str(client / "code.ccp"), str(bin64)])
    dll_directory = os.add_dll_directory(str(bin64)) if os.name == "nt" else None
    try:
        result = extract(client, cache)
        write_snapshot(result, args.out)
    finally:
        if dll_directory is not None:
            dll_directory.close()
    print(f'Extracted {len(result["facilities"])} facilities and '
          f'{len(result["blueprints"])} blueprints from build {result["build"]}')


if __name__ == "__main__":
    main()
