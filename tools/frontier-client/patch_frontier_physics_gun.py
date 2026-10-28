#!/usr/bin/env python3
"""Install the build-3502403 Physics Gun static data and activation overlay."""

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
MODULE_SHA256 = {
    "frontier/skillshot/profile.pyc": "fc3c68c3c285ca989c98b896ff91ab1a4fcb038aea0546ebde67007061e74ba2",
    "evetypes/data.pyc": "a09bb8b45975fe016b71f5abd9527d4f507c19e2be11c69b0927f30b19735ba1",
    "dogma/data.pyc": "a36e9f0b38c80407cdd987de9e901aced961a70388aefad4952973de3950f7ad",
    "frontier/creation/common/data_loader.pyc": "19a5a38dd8ecd17e2d87d8c672bde64228ab1ec4313259a2053bd233f7d1e132",
    "localization/__init__.pyc": "d5f3ff04271c7baed8ad895bd839ef7e23a002c2614ca55b6547b6d27a72ca25",
    "evetypes/localizationUtils.pyc": "769b0c1ab274af501f347d506c33126ad1d05f9e01f24c88f8c0d1395ee158d9",
}
ADAPTER = Path(__file__).with_name("physics_gun_adapter.py")
SOURCE_SENTINEL = b"EVEJS_PHYSICS_GUN_ORIGINAL_V1"
ADAPTER_SENTINEL = b"EVEJS_PHYSICS_GUN_ADAPTER_V1"


class PhysicsGunPatchError(RuntimeError):
    pass


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def patched_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(ADAPTER.read_text(encoding="utf-8"),
                      "evejs/physics_gun_adapter.py", "exec", dont_inherit=True)
    wrapper = compile(
        "import marshal as _evejs_physics_gun_marshal\n"
        "exec(_evejs_physics_gun_marshal.loads(b'EVEJS_PHYSICS_GUN_ORIGINAL_V1'[16:]))\n"
        "exec(_evejs_physics_gun_marshal.loads(b'EVEJS_PHYSICS_GUN_ADAPTER_V1'))\n"
        "_evejs_install_physics_gun(globals())\n",
        original.co_filename, "exec", dont_inherit=True)
    constants = tuple(
        member if value == SOURCE_SENTINEL else
        marshal.dumps(adapter) if value == ADAPTER_SENTINEL else value
        for value in wrapper.co_consts)
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def inspect_member(name, member):
    if len(member) < 16 or member[:4] != importlib.util.MAGIC_NUMBER:
        raise PhysicsGunPatchError(f"Unexpected Python bytecode header: {name}")
    if sha256(member) == MODULE_SHA256[name]:
        return "source", member
    try:
        wrapper = marshal.loads(member[16:])
        if not isinstance(wrapper, types.CodeType):
            raise ValueError("Not a code object")
        originals = [value for value in wrapper.co_consts
                     if isinstance(value, bytes)
                     and sha256(value) == MODULE_SHA256[name]]
        if len(originals) == 1:
            original = originals[0]
            return ("patched" if patched_member(original) == member else "outdated"), original
    except (EOFError, TypeError, ValueError):
        pass
    raise PhysicsGunPatchError(f"{name} differs from the supported source or patch")


def inspect_archive(archive, build=BUILD):
    if build != BUILD:
        raise PhysicsGunPatchError(f"No Physics Gun patch for build {build}")
    with zipfile.ZipFile(archive) as source:
        states = []
        for name in MODULE_SHA256:
            if source.namelist().count(name) != 1:
                raise PhysicsGunPatchError(f"Expected exactly one {name}")
            states.append(inspect_member(name, source.read(name))[0])
    return states[0] if len(set(states)) == 1 else "partial"


def patch_archive(archive, build=BUILD):
    state = inspect_archive(archive, build)
    if state == "partial":
        raise PhysicsGunPatchError("Physics Gun patch is partial")
    if state in {"source", "outdated"}:
        with zipfile.ZipFile(archive) as source:
            updates = {
                name: patched_member(inspect_member(name, source.read(name))[1])
                for name in MODULE_SHA256
            }
        rewrite_archive(archive, updates)
    if inspect_archive(archive, build) != "patched":
        raise PhysicsGunPatchError("Physics Gun patch verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--build", type=int, default=BUILD)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise PhysicsGunPatchError("Python 3.12 exactly is required")
    if args.check:
        print(inspect_archive(args.archive, args.build))
    else:
        patch_archive(args.archive, args.build)
        print("patched")


if __name__ == "__main__":
    try:
        main()
    except (PhysicsGunPatchError, OSError, zipfile.BadZipFile) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        raise SystemExit(1)
