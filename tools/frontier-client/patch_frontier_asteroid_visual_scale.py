#!/usr/bin/env python3
"""Install the build-3502403 dungeon asteroid visual-radius adapter."""

import argparse
import hashlib
import importlib.util
import marshal
from pathlib import Path
import sys
import types
import zipfile

from patch_frontier_features import rewrite_archive


BUILD = 3502403
MODULE = "eve/client/script/environment/spaceObject/scalableSpaceObject.pyc"
SOURCE_SHA256 = "660d5bc8e4dd58a4e76c6c080fea28bcf7a0dc82aaabde5745be4690c831b586"
PREVIOUS_WRAPPER_SHA256 = {
    "70afc129c460c865c7182660c9321a8c1a8244e058e2ba9e3ad417bac065f468",
    "b9faa6b43d63878f9e4a77351674f143c4e077798a0a91606574db29557cf612",
    "13a345f038b9b61172f2529a45ae26c6c6afed45bdc7b610751138f5960423e7",
    "2b4e87218be03b08e85059e6a70ee02be31ec809420f3204a53960704d706c01",
}
ADAPTER = Path(__file__).with_name("asteroid_visual_scale_adapter.py")
SOURCE_SENTINEL = b"EVEJS_ASTEROID_VISUAL_SCALE_ORIGINAL_V1"
ADAPTER_SENTINEL = b"EVEJS_ASTEROID_VISUAL_SCALE_ADAPTER_V1"


class AsteroidVisualScalePatchError(RuntimeError):
    pass


def patched_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(ADAPTER.read_text(encoding="utf-8"),
                      "evejs/asteroid_visual_scale_adapter.py", "exec",
                      dont_inherit=True)
    wrapper = compile(
        "import marshal as _evejs_asteroid_scale_marshal\n"
        "exec(_evejs_asteroid_scale_marshal.loads(b'EVEJS_ASTEROID_VISUAL_SCALE_ORIGINAL_V1'[16:]))\n"
        "exec(_evejs_asteroid_scale_marshal.loads(b'EVEJS_ASTEROID_VISUAL_SCALE_ADAPTER_V1'))\n"
        "_evejs_install_asteroid_visual_scale(globals())\n",
        original.co_filename, "exec", dont_inherit=True)
    constants = tuple(
        member if value == SOURCE_SENTINEL else
        marshal.dumps(adapter) if value == ADAPTER_SENTINEL else value
        for value in wrapper.co_consts)
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def inspect_member(member):
    if len(member) < 16 or member[:4] != importlib.util.MAGIC_NUMBER:
        raise AsteroidVisualScalePatchError("Unexpected Python bytecode header")
    if hashlib.sha256(member).hexdigest() == SOURCE_SHA256:
        return "source", member
    try:
        wrapper = marshal.loads(member[16:])
        if not isinstance(wrapper, types.CodeType):
            raise ValueError("Not a code object")
        originals = [value for value in wrapper.co_consts
                     if isinstance(value, bytes)
                     and hashlib.sha256(value).hexdigest() == SOURCE_SHA256]
        if len(originals) == 1:
            if patched_member(originals[0]) == member:
                return "patched", originals[0]
            if hashlib.sha256(member).hexdigest() in PREVIOUS_WRAPPER_SHA256:
                return "outdated", originals[0]
    except (EOFError, TypeError, ValueError):
        pass
    raise AsteroidVisualScalePatchError(
        "ScalableSpaceObject differs from the supported source or patch")


def inspect_archive(archive, build=BUILD):
    if build != BUILD:
        raise AsteroidVisualScalePatchError(
            f"No asteroid visual-scale patch is available for build {build}")
    with zipfile.ZipFile(archive) as source:
        entries = [entry for entry in source.infolist() if entry.filename == MODULE]
        if len(entries) != 1:
            raise AsteroidVisualScalePatchError(f"Expected exactly one {MODULE}")
        return inspect_member(source.read(entries[0]))[0]


def patch_archive(archive, build=BUILD):
    if inspect_archive(archive, build) in {"source", "outdated"}:
        with zipfile.ZipFile(archive) as source:
            _, original = inspect_member(source.read(MODULE))
        rewrite_archive(archive, {MODULE: patched_member(original)})
    if inspect_archive(archive, build) != "patched":
        raise AsteroidVisualScalePatchError("Asteroid scale patch verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--build", type=int, default=BUILD)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise AsteroidVisualScalePatchError("Python 3.12 exactly is required")
    if args.check:
        print(inspect_archive(args.archive, args.build))
    else:
        patch_archive(args.archive, args.build)
        print("patched")


if __name__ == "__main__":
    try:
        main()
    except (AsteroidVisualScalePatchError, OSError, zipfile.BadZipFile) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        raise SystemExit(1)
