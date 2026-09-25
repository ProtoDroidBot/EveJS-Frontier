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
SCENE_MODULE_NAME = "eve/client/script/ui/shared/mapView/mapView.pyc"
SCENE_SOURCE_SHA256 = "8988074150c99949b45ca4028493cd29557a06ea137ff23f5ae1a7bb78815169"
SCENE_ADAPTER = Path(__file__).with_name("map_view_scene_adapter.py")
SOURCE_SENTINEL = b"EVEJS_MAP_VIEW_ORIGINAL_MEMBER_V1"
ADAPTER_SENTINEL = b"EVEJS_MAP_VIEW_ADAPTER_CODE_V1"
SCENE_SOURCE_SENTINEL = b"EVEJS_MAP_SCENE_ORIGINAL_MEMBER_V1"
SCENE_ADAPTER_SENTINEL = b"EVEJS_MAP_SCENE_ADAPTER_CODE_V1"
UPGRADEABLE_ADAPTER_CODE_SHA256S = {
    # Original lifecycle-only adapter.
    "d8bdf08c29f3191bca104f92ded4c83fb4b5011cd350587c9ac18db9a7e9170e",
    # Lifecycle + resolved-dungeon visibility adapter shipped before the
    # model-only NPC/ship presentation rule.
    "4354158b8b749032c1bbd719e7d2cf97a9d4c7ec14205f20ec4017e1463546c3",
    # Short-lived model-only NPC/ship adapter. It hid the resolved ball bracket
    # after ScanResolvedPendingCriteria released it, so upgrade it back to the
    # client's native unresolved-signature -> resolved-bracket lifecycle.
    "6af08856aebd188b0b0df7198ef4002f5712f5f1e061d7f3d0b948121dac6931",
}


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


def patched_scene_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        SCENE_ADAPTER.read_text(encoding="utf-8"),
        "evejs/map_view_scene_adapter.py", "exec", dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_map_scene_marshal\n"
        "exec(_evejs_map_scene_marshal.loads(b'EVEJS_MAP_SCENE_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_map_scene_marshal.loads(b'EVEJS_MAP_SCENE_ADAPTER_CODE_V1'))\n"
        "_evejs_install_map_view_scene_lifecycle(globals())\n",
        original.co_filename, "exec", dont_inherit=True,
    )
    constants = tuple(
        member if value == SCENE_SOURCE_SENTINEL else
        marshal.dumps(adapter) if value == SCENE_ADAPTER_SENTINEL else value
        for value in wrapper.co_consts
    )
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def inspect_scene_member(member, expected=SCENE_SOURCE_SHA256):
    if len(member) < 16 or member[:4] != importlib.util.MAGIC_NUMBER:
        raise MapViewPatchError("Unexpected map scene bytecode header")
    if hashlib.sha256(member).hexdigest() == expected:
        return "source", member
    try:
        wrapper = marshal.loads(member[16:])
        if not isinstance(wrapper, types.CodeType):
            raise ValueError("Not a code object")
        originals = [
            value for value in wrapper.co_consts
            if isinstance(value, bytes) and hashlib.sha256(value).hexdigest() == expected
        ]
        if len(originals) == 1 and patched_scene_member(originals[0]) == member:
            return "patched", originals[0]
    except (EOFError, TypeError, ValueError):
        pass
    raise MapViewPatchError("Map scene module differs from the supported source or patch")


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
            and hashlib.sha256(value).hexdigest()
            in UPGRADEABLE_ADAPTER_CODE_SHA256S
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
        for name in (MODULE_NAME, SCENE_MODULE_NAME):
            if source.namelist().count(name) != 1:
                raise MapViewPatchError(f"Expected exactly one {name}")
        bracket_state = inspect_member(source.read(MODULE_NAME))[0]
        scene_state = inspect_scene_member(source.read(SCENE_MODULE_NAME))[0]
        return "patched" if bracket_state == scene_state == "patched" else "source"


def patch_archive(archive, build=BUILD):
    inspect_archive(archive, build)
    with zipfile.ZipFile(archive) as source:
        bracket_state, bracket_original = inspect_member(source.read(MODULE_NAME))
        scene_state, scene_original = inspect_scene_member(source.read(SCENE_MODULE_NAME))
    updates = {}
    if bracket_state == "source":
        updates[MODULE_NAME] = patched_member(bracket_original)
    if scene_state == "source":
        updates[SCENE_MODULE_NAME] = patched_scene_member(scene_original)
    if updates:
        rewrite_archive(archive, updates)
    if inspect_archive(archive, build) != "patched":
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
        print(inspect_archive(args.archive, args.build))
    else:
        patch_archive(args.archive, args.build)
        print("patched")


if __name__ == "__main__":
    try:
        main()
    except (MapViewPatchError, OSError, zipfile.BadZipFile) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        raise SystemExit(1)
