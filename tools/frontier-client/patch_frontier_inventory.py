#!/usr/bin/env python3
"""Install the verified build-3502403 full-screen inventory compatibility fix."""

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
PROFILES = {
    "frontier/hud/inventory/client/open.pyc": (
        "open",
        "5a4a20255e0702eb5233092f9b43e29d8816e8389926c4f3fce80ea607b40beb",
    ),
    "frontier/hud/inventory/client/view_state.pyc": (
        "view_state",
        "b886cc98fe362c12ede9d60d3b8f523d64414c9e067b2bc8d15cbec8c3600629",
    ),
}
ADAPTER = Path(__file__).with_name("inventory_view_compatibility_adapter.py")
SOURCE_SENTINEL = b"EVEJS_INVENTORY_VIEW_ORIGINAL_MEMBER_V1"
ADAPTER_SENTINEL = b"EVEJS_INVENTORY_VIEW_ADAPTER_CODE_V1"
# Exact installed wrappers preceding the independent-operation guards.
PREVIOUS_WRAPPER_SHA256 = {
    "open": "5e3b741a376507a675064ba62c57890fe5c4a1d3976a2724833721790d7a47b3",
    "view_state": "d9c4588e940996e11d9725ce9b18e68ae430fd1effca6f84e0df30ddd6acfb52",
}


class InventoryViewPatchError(RuntimeError):
    pass


def patched_member(member, kind):
    original = marshal.loads(member[16:])
    adapter = compile(
        ADAPTER.read_text(encoding="utf-8"),
        "evejs/inventory_view_compatibility_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_inventory_view_marshal\n"
        "exec(_evejs_inventory_view_marshal.loads(b'EVEJS_INVENTORY_VIEW_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_inventory_view_marshal.loads(b'EVEJS_INVENTORY_VIEW_ADAPTER_CODE_V1'))\n"
        f"_evejs_install_inventory_view_compatibility(globals(), {kind!r})\n",
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


def inspect_member(member, kind, expected):
    if len(member) < 16 or member[:4] != importlib.util.MAGIC_NUMBER:
        raise InventoryViewPatchError("Unexpected Python bytecode header")
    if hashlib.sha256(member).hexdigest() == expected:
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
        if len(originals) == 1:
            if patched_member(originals[0], kind) == member:
                return "patched", originals[0]
            if hashlib.sha256(member).hexdigest() == PREVIOUS_WRAPPER_SHA256.get(kind):
                return "outdated", originals[0]
    except (EOFError, TypeError, ValueError):
        pass
    raise InventoryViewPatchError(
        "Inventory view module differs from the exact supported source or patch"
    )


def inspect_archive(archive, build=BUILD):
    if build != BUILD:
        raise InventoryViewPatchError(
            f"No full-screen inventory patch is available for build {build}"
        )
    results = {}
    digests = {}
    with zipfile.ZipFile(archive) as source:
        for module_name, (kind, expected) in PROFILES.items():
            entries = [
                entry
                for entry in source.infolist()
                if entry.filename == module_name
            ]
            if len(entries) != 1:
                raise InventoryViewPatchError(f"Expected exactly one {module_name}")
            member = source.read(entries[0])
            digests[module_name] = hashlib.sha256(member).hexdigest()
            results[module_name] = inspect_member(member, kind, expected)
    if digests == {
        name: PREVIOUS_WRAPPER_SHA256[kind]
        for name, (kind, _expected) in PROFILES.items()
    }:
        return "outdated", results
    states = {state for state, _ in results.values()}
    state = states.pop() if len(states) == 1 else "partial"
    return state, results


def patch_archive(archive, build=BUILD):
    state, results = inspect_archive(archive, build)
    if state == "partial":
        raise InventoryViewPatchError("Inventory view adapter is only partially installed")
    if state != "patched":
        replacements = {}
        for module_name, (kind, _expected) in PROFILES.items():
            member_state, original = results[module_name]
            if member_state != "patched":
                replacements[module_name] = patched_member(original, kind)
        rewrite_archive(archive, replacements)
    if inspect_archive(archive, build)[0] != "patched":
        raise InventoryViewPatchError("Full-screen inventory patch verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--build", type=int, default=BUILD)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise InventoryViewPatchError(
            "Python 3.12 exactly is required for client bytecode"
        )
    if args.check:
        print(inspect_archive(args.archive, args.build)[0])
    else:
        patch_archive(args.archive, args.build)
        print("patched")


if __name__ == "__main__":
    try:
        main()
    except (InventoryViewPatchError, OSError, zipfile.BadZipFile) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        raise SystemExit(1)
