#!/usr/bin/env python3
"""Install the build-3502403 dungeon prop hologram preview adapter."""

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
MODULE = "eve/client/script/remote/michelle.pyc"
SOURCE_SHA256 = "08dc47213d7c506c750d3d4e681312a1b36cdcc3450ee54064050e20fd86036e"
PREVIOUS_WRAPPER_SHA256 = {
    "4a320fc73a2a19523fff6f2b38132cbd25e9f2ab38f807abc160eaa5c30fb23f",
    "fac6385de78a8af377d4801b80cfcd818ddaf73af0cc79fa561823cf4a7896aa",
}
ADAPTER = Path(__file__).with_name("dungeon_prop_hologram_adapter.py")
# Michelle already has an exact-build wrapper here. Keep the Physics Gun-only
# presentation hook in the same wrapper instead of stacking archive patches.
PHYSICS_INTERPOLATION_ADAPTER = Path(__file__).with_name(
    "physics_gun_interpolation_adapter.py")
SOURCE_SENTINEL = b"EVEJS_DUNGEON_PROP_HOLOGRAM_ORIGINAL_V1"
ADAPTER_SENTINEL = b"EVEJS_DUNGEON_PROP_HOLOGRAM_ADAPTER_V1"


class DungeonPropHologramPatchError(RuntimeError):
    pass


def patched_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(ADAPTER.read_text(encoding="utf-8") + "\n" +
                      PHYSICS_INTERPOLATION_ADAPTER.read_text(encoding="utf-8"),
                      "evejs/dungeon_prop_hologram_adapter.py", "exec",
                      dont_inherit=True)
    wrapper = compile(
        "import marshal as _evejs_dungeon_holo_marshal\n"
        "exec(_evejs_dungeon_holo_marshal.loads(b'EVEJS_DUNGEON_PROP_HOLOGRAM_ORIGINAL_V1'[16:]))\n"
        "exec(_evejs_dungeon_holo_marshal.loads(b'EVEJS_DUNGEON_PROP_HOLOGRAM_ADAPTER_V1'))\n"
        "_evejs_install_dungeon_prop_hologram(globals())\n"
        "_evejs_install_physics_gun_interpolation(globals())\n",
        original.co_filename, "exec", dont_inherit=True)
    constants = tuple(
        member if value == SOURCE_SENTINEL else
        marshal.dumps(adapter) if value == ADAPTER_SENTINEL else value
        for value in wrapper.co_consts)
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def inspect_member(member):
    if len(member) < 16 or member[:4] != importlib.util.MAGIC_NUMBER:
        raise DungeonPropHologramPatchError("Unexpected Python bytecode header")
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
    raise DungeonPropHologramPatchError(
        "Michelle module differs from the supported source or patch")


def inspect_archive(archive, build=BUILD):
    if build != BUILD:
        raise DungeonPropHologramPatchError(
            f"No dungeon hologram patch is available for build {build}")
    with zipfile.ZipFile(archive) as source:
        entries = [entry for entry in source.infolist() if entry.filename == MODULE]
        if len(entries) != 1:
            raise DungeonPropHologramPatchError(f"Expected exactly one {MODULE}")
        return inspect_member(source.read(entries[0]))[0]


def patch_archive(archive, build=BUILD):
    state = inspect_archive(archive, build)
    if state in {"source", "outdated"}:
        with zipfile.ZipFile(archive) as source:
            _, original = inspect_member(source.read(MODULE))
        rewrite_archive(archive, {MODULE: patched_member(original)})
    if inspect_archive(archive, build) != "patched":
        raise DungeonPropHologramPatchError("Dungeon hologram patch verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--build", type=int, default=BUILD)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise DungeonPropHologramPatchError("Python 3.12 exactly is required")
    if args.check:
        print(inspect_archive(args.archive, args.build))
    else:
        patch_archive(args.archive, args.build)
        print("patched")


if __name__ == "__main__":
    try:
        main()
    except (DungeonPropHologramPatchError, OSError, zipfile.BadZipFile) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        raise SystemExit(1)
