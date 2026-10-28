#!/usr/bin/env python3
"""Install build-3502403 fitted turret and launcher target tracking."""

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
MODULE_NAME = "eve/client/script/parklife/turret.pyc"
SOURCE_MEMBER_SHA256 = "f4a940cab083a94f863a3cc613b926d6b79e2c5769fd18c55aaee91fc311bf35"
ADAPTER = Path(__file__).with_name("turret_target_tracking_adapter.py")
SOURCE_SENTINEL = b"EVEJS_TURRET_SERVICE_ORIGINAL_MEMBER_V1"
ADAPTER_SENTINEL = b"EVEJS_TURRET_SERVICE_ADAPTER_CODE_V1"
PREVIOUS_WRAPPER_SHA256 = {
    "014a578d568e7b39e17d903e4f65b6a752bcbd28fbbb5b8ee7beda062fb62f6f",
}


class TurretTrackingPatchError(RuntimeError):
    pass


def patched_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        ADAPTER.read_text(encoding="utf-8"),
        "evejs/turret_target_tracking_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_turret_marshal\n"
        "exec(_evejs_turret_marshal.loads(b'EVEJS_TURRET_SERVICE_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_turret_marshal.loads(b'EVEJS_TURRET_SERVICE_ADAPTER_CODE_V1'))\n"
        "_evejs_install_turret_target_tracking(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member if value == SOURCE_SENTINEL else
        marshal.dumps(adapter) if value == ADAPTER_SENTINEL else value
        for value in wrapper.co_consts
    )
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def inspect_member(member):
    if len(member) < 16 or member[:4] != importlib.util.MAGIC_NUMBER:
        raise TurretTrackingPatchError("Unexpected Python bytecode header")
    if hashlib.sha256(member).hexdigest() == SOURCE_MEMBER_SHA256:
        return "source", member
    try:
        wrapper = marshal.loads(member[16:])
        if not isinstance(wrapper, types.CodeType):
            raise ValueError("Not a code object")
        originals = [
            value for value in wrapper.co_consts
            if isinstance(value, bytes) and
            hashlib.sha256(value).hexdigest() == SOURCE_MEMBER_SHA256
        ]
        if len(originals) == 1:
            if patched_member(originals[0]) == member:
                return "patched", originals[0]
            if hashlib.sha256(member).hexdigest() in PREVIOUS_WRAPPER_SHA256:
                return "outdated", originals[0]
    except (EOFError, TypeError, ValueError):
        pass
    raise TurretTrackingPatchError("Turret service differs from the supported build")


def inspect_archive(archive, build=BUILD):
    if build != BUILD:
        raise TurretTrackingPatchError(
            f"No turret tracking patch is available for build {build}"
        )
    with zipfile.ZipFile(archive) as source:
        entries = [
            entry for entry in source.infolist()
            if entry.filename == MODULE_NAME
        ]
        if len(entries) != 1:
            raise TurretTrackingPatchError(f"Expected exactly one {MODULE_NAME}")
        return inspect_member(source.read(entries[0]))


def patch_archive(archive, build=BUILD):
    state, original = inspect_archive(archive, build)
    if state in {"source", "outdated"}:
        rewrite_archive(archive, {MODULE_NAME: patched_member(original)})
    if inspect_archive(archive, build)[0] != "patched":
        raise TurretTrackingPatchError("Turret tracking patch verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--build", type=int, default=BUILD)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise TurretTrackingPatchError("Python 3.12 exactly is required for client bytecode")
    if args.check:
        print(inspect_archive(args.archive, args.build)[0])
    else:
        patch_archive(args.archive, args.build)
        print("patched")


if __name__ == "__main__":
    main()
