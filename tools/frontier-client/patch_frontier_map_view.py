#!/usr/bin/env python3
"""Install the verified build-3502403 Frontier system-view fixes."""

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
MODULE_NAME = "frontier/hud/bracket/state.pyc"
SOURCE_MEMBER_SHA256 = "55ac03aed94839e454c947aab18fc5fbfe7a7eddc5178dbf7fad59ba4abb848a"
ADAPTER = Path(__file__).with_name("map_view_lifecycle_adapter.py")
SOURCE_SENTINEL = b"EVEJS_MAP_VIEW_ORIGINAL_MEMBER_V1"
ADAPTER_SENTINEL = b"EVEJS_MAP_VIEW_ADAPTER_CODE_V1"
LEGACY_ADAPTER_CODE_SHA256 = (
    "d8bdf08c29f3191bca104f92ded4c83fb4b5011cd350587c9ac18db9a7e9170e"
)


class MapViewPatchError(RuntimeError):
    pass


def patched_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        ADAPTER.read_text(encoding="utf-8"),
        "evejs/map_view_lifecycle_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_map_view_marshal\n"
        "exec(_evejs_map_view_marshal.loads(b'EVEJS_MAP_VIEW_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_map_view_marshal.loads(b'EVEJS_MAP_VIEW_ADAPTER_CODE_V1'))\n"
        "_evejs_install_map_view_lifecycle(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == ADAPTER_SENTINEL
        else value
        for value in wrapper.co_consts
    )
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def inspect_member(member, expected=SOURCE_MEMBER_SHA256):
    if len(member) < 16 or member[:4] != importlib.util.MAGIC_NUMBER:
        raise MapViewPatchError("Unexpected Python bytecode header")
    digest = hashlib.sha256(member).hexdigest()
    if digest == expected:
        return "source", member
    try:
        wrapper = marshal.loads(member[16:])
        if not isinstance(wrapper, types.CodeType):
            raise ValueError("Not a code object")
        originals = [
            value
            for value in wrapper.co_consts
            if isinstance(value, bytes)
            and hashlib.sha256(value).hexdigest() == expected
        ]
        if len(originals) == 1 and patched_member(originals[0]) == member:
            return "patched", originals[0]
        adapters = [
            value
            for value in wrapper.co_consts
            if isinstance(value, bytes)
            and hashlib.sha256(value).hexdigest() == LEGACY_ADAPTER_CODE_SHA256
        ]
        if len(originals) == 1 and len(adapters) == 1:
            # Treat the lifecycle-only adapter as an upgradeable source.  This
            # lets an already completed 3502403 stage receive the site marker
            # fix through the normal transactional stage-upgrade path.
            return "source", originals[0]
    except (EOFError, TypeError, ValueError):
        pass
    raise MapViewPatchError(
        "Map-view module differs from the exact supported source or patch"
    )


def inspect_archive(archive, build=BUILD):
    if build != BUILD:
        raise MapViewPatchError(
            f"No map-view lifecycle patch is available for build {build}"
        )
    with zipfile.ZipFile(archive) as source:
        entries = [
            entry for entry in source.infolist() if entry.filename == MODULE_NAME
        ]
        if len(entries) != 1:
            raise MapViewPatchError(f"Expected exactly one {MODULE_NAME}")
        return inspect_member(source.read(entries[0]))


def patch_archive(archive, build=BUILD):
    state, original = inspect_archive(archive, build)
    if state == "source":
        rewrite_archive(archive, {MODULE_NAME: patched_member(original)})
    if inspect_archive(archive, build)[0] != "patched":
        raise MapViewPatchError("Map-view lifecycle patch verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--build", type=int, default=BUILD)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise MapViewPatchError("Python 3.12 exactly is required for client bytecode")
    if args.check:
        print(inspect_archive(args.archive, args.build)[0])
    else:
        patch_archive(args.archive, args.build)
        print("patched")


if __name__ == "__main__":
    try:
        main()
    except (MapViewPatchError, OSError, zipfile.BadZipFile) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        raise SystemExit(1)
