#!/usr/bin/env python3
"""Install the verified build-3502403 non-modular fitting compatibility fix."""

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
MODULE_NAME = "eve/client/script/ui/eveCommands.pyc"
SOURCE_MEMBER_SHA256 = "533a19a7e8e995f415bd9f2649b52d64372538de240791d8b5c227ef76c24f4d"
CREATION_SERVICE_MODULE_NAME = "frontier/creation/client/service.pyc"
CREATION_SERVICE_SOURCE_MEMBER_SHA256 = "55d9b955b0ab99fed39032db1580076946fb2e554c0ac8691eb7747d792f367c"
PREVIOUS_WRAPPER_SHA256 = {
    "3a8b251364c9ca5dcf18f44518a5283869377f4781546885d916a57b8007910a",
    "74bd5fc669dbb04177083c1cdcb4350b3e2ba569a52208fd94b5f446b0c0f1e8",
    "0d79a1a445efe2fe3a6b44eb2afd093b40e0d6e2a9213b55cb520b0a1a7e3b56",
}
ADAPTER = Path(__file__).with_name("fitting_compatibility_adapter.py")
CREATION_SERVICE_ADAPTER = Path(__file__).with_name(
    "creation_service_compatibility_adapter.py"
)
SOURCE_SENTINEL = b"EVEJS_FITTING_ORIGINAL_MEMBER_V1"
ADAPTER_SENTINEL = b"EVEJS_FITTING_ADAPTER_CODE_V1"
CREATION_SERVICE_SOURCE_SENTINEL = b"EVEJS_CREATION_SERVICE_ORIGINAL_MEMBER_V1"
CREATION_SERVICE_ADAPTER_SENTINEL = b"EVEJS_CREATION_SERVICE_ADAPTER_CODE_V1"


class FittingPatchError(RuntimeError):
    pass


def patched_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        ADAPTER.read_text(encoding="utf-8"),
        "evejs/fitting_compatibility_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_fitting_marshal\n"
        "exec(_evejs_fitting_marshal.loads(b'EVEJS_FITTING_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_fitting_marshal.loads(b'EVEJS_FITTING_ADAPTER_CODE_V1'))\n"
        "_evejs_install_fitting_compatibility(globals())\n",
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


def patched_creation_service_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        CREATION_SERVICE_ADAPTER.read_text(encoding="utf-8"),
        "evejs/creation_service_compatibility_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_creation_service_marshal\n"
        "exec(_evejs_creation_service_marshal.loads(b'EVEJS_CREATION_SERVICE_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_creation_service_marshal.loads(b'EVEJS_CREATION_SERVICE_ADAPTER_CODE_V1'))\n"
        "_evejs_install_creation_service_compatibility(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == CREATION_SERVICE_SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == CREATION_SERVICE_ADAPTER_SENTINEL
        else value
        for value in wrapper.co_consts
    )
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def inspect_member(
    member,
    expected=SOURCE_MEMBER_SHA256,
    build_patched_member=patched_member,
    previous_wrapper_sha256=None,
):
    if previous_wrapper_sha256 is None:
        previous_wrapper_sha256 = PREVIOUS_WRAPPER_SHA256
    if len(member) < 16 or member[:4] != importlib.util.MAGIC_NUMBER:
        raise FittingPatchError("Unexpected Python bytecode header")
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
        if digest in previous_wrapper_sha256:
            if len(originals) == 1:
                return "outdated", originals[0]
            raise ValueError("Previous wrapper did not contain its retail original")
        if len(originals) == 1 and build_patched_member(originals[0]) == member:
            return "patched", originals[0]
    except (EOFError, TypeError, ValueError):
        pass
    raise FittingPatchError(
        "Fitting command module differs from the exact supported source or patch"
    )


def inspect_archive(archive, build=BUILD):
    if build != BUILD:
        raise FittingPatchError(
            f"No non-modular fitting patch is available for build {build}"
        )
    with zipfile.ZipFile(archive) as source:
        entries_by_name = {}
        for module_name in (MODULE_NAME, CREATION_SERVICE_MODULE_NAME):
            entries = [
                entry
                for entry in source.infolist()
                if entry.filename == module_name
            ]
            if len(entries) != 1:
                raise FittingPatchError(f"Expected exactly one {module_name}")
            entries_by_name[module_name] = entries[0]

        command_state, command_original = inspect_member(
            source.read(entries_by_name[MODULE_NAME])
        )
        service_state, service_original = inspect_member(
            source.read(entries_by_name[CREATION_SERVICE_MODULE_NAME]),
            CREATION_SERVICE_SOURCE_MEMBER_SHA256,
            patched_creation_service_member,
            set(),
        )

    states = {command_state, service_state}
    if states == {"patched"}:
        state = "patched"
    elif states == {"source"}:
        state = "source"
    else:
        state = "outdated"
    return state, {
        MODULE_NAME: (command_state, command_original),
        CREATION_SERVICE_MODULE_NAME: (service_state, service_original),
    }


def patch_archive(archive, build=BUILD):
    state, originals = inspect_archive(archive, build)
    if state in {"source", "outdated"}:
        replacements = {}
        command_state, command_original = originals[MODULE_NAME]
        if command_state != "patched":
            replacements[MODULE_NAME] = patched_member(command_original)
        service_state, service_original = originals[CREATION_SERVICE_MODULE_NAME]
        if service_state != "patched":
            replacements[CREATION_SERVICE_MODULE_NAME] = (
                patched_creation_service_member(service_original)
            )
        rewrite_archive(archive, replacements)
    if inspect_archive(archive, build)[0] != "patched":
        raise FittingPatchError("Non-modular fitting patch verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--build", type=int, default=BUILD)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise FittingPatchError("Python 3.12 exactly is required for client bytecode")
    if args.check:
        print(inspect_archive(args.archive, args.build)[0])
    else:
        patch_archive(args.archive, args.build)
        print("patched")


if __name__ == "__main__":
    try:
        main()
    except (FittingPatchError, OSError, zipfile.BadZipFile) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        raise SystemExit(1)
