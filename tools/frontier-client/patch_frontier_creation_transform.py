#!/usr/bin/env python3
"""Install verified Creation mirror/flip support in Frontier build 3502403."""

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
MODULES = {
    "frontier/creation/client/management/integration.pyc": (
        "5d06b9f846c4bfee3b0dcda925144306a5754777bf93f0bf077c2327bdc8dd60",
        Path(__file__).with_name("creation_transform_adapter.py"),
        "_evejs_install_creation_transforms",
        b"EVEJS_CREATION_TRANSFORM_INTEGRATION_ORIGINAL_V1",
        b"EVEJS_CREATION_TRANSFORM_INTEGRATION_ADAPTER_V1",
    ),
    "frontier/creation/common/validation.pyc": (
        "578a21c3f7ff5c6bf62a4672a684958c7f18765687846bc3a5adbb84975e0ef5",
        Path(__file__).with_name("creation_transform_validation_adapter.py"),
        "_evejs_install_creation_transform_validation",
        b"EVEJS_CREATION_TRANSFORM_VALIDATION_ORIGINAL_V1",
        b"EVEJS_CREATION_TRANSFORM_VALIDATION_ADAPTER_V1",
    ),
    "frontier/creation/client/management/view.pyc": (
        "e9996dee87d5e243706e4ffbd83fd45f1a8f8b838e779fbd66f7ea527b8095c4",
        Path(__file__).with_name("creation_preset_view_adapter.py"),
        "_evejs_install_creation_preset_view",
        b"EVEJS_CREATION_PRESET_VIEW_ORIGINAL_V1",
        b"EVEJS_CREATION_PRESET_VIEW_ADAPTER_V1",
    ),
}
PREVIOUS_WRAPPER_SHA256 = {
    "creation_transform_adapter.py": {
        "21f0847e98fec8942dc02726a570fcb501bfbb3288bd80874d232b9cbf17d496",
        "d150d80d35ea1f083c42f91100cf19b1b8a9f1163620f0e8f67477f5e2c8e74a",
    },
    "creation_transform_validation_adapter.py": {
        "cf01cd48c5a144710e77f0ee6f86125f95481e05d774c9212289e36904baad2a",
    },
    "creation_preset_view_adapter.py": {
        "c12b64acca01686d1b85f5b8bc9e00addee14db3239938f84d03f8fb503609da",
    },
}


class CreationTransformPatchError(RuntimeError):
    pass


def patched_member(member, adapter_path, installer, source_sentinel, adapter_sentinel):
    original = marshal.loads(member[16:])
    adapter = compile(
        adapter_path.read_text(encoding="utf-8"),
        f"evejs/{adapter_path.name}",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_creation_transform_marshal\n"
        f"exec(_evejs_creation_transform_marshal.loads({source_sentinel!r}[16:]))\n"
        f"exec(_evejs_creation_transform_marshal.loads({adapter_sentinel!r}))\n"
        f"{installer}(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member if value == source_sentinel
        else marshal.dumps(adapter) if value == adapter_sentinel
        else value
        for value in wrapper.co_consts
    )
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def inspect_member(member, module_config):
    expected, adapter_path, installer, source_sentinel, adapter_sentinel = module_config
    if len(member) < 16 or member[:4] != importlib.util.MAGIC_NUMBER:
        raise CreationTransformPatchError("Unexpected Python bytecode header")
    if hashlib.sha256(member).hexdigest() == expected:
        return "source", member
    digest = hashlib.sha256(member).hexdigest()
    try:
        wrapper = marshal.loads(member[16:])
        if not isinstance(wrapper, types.CodeType):
            raise ValueError("Not a code object")
        originals = [
            value for value in wrapper.co_consts
            if isinstance(value, bytes)
            and hashlib.sha256(value).hexdigest() == expected
        ]
        if len(originals) == 1:
            if patched_member(
                originals[0], adapter_path, installer,
                source_sentinel, adapter_sentinel,
            ) == member:
                return "patched", originals[0]
            if digest in PREVIOUS_WRAPPER_SHA256.get(adapter_path.name, ()):
                return "outdated", originals[0]
    except (EOFError, TypeError, ValueError):
        pass
    raise CreationTransformPatchError(
        "Creation transform module differs from the supported source or patch"
    )


def inspect_archive(archive, build=BUILD):
    if build != BUILD:
        raise CreationTransformPatchError(
            f"No Creation transform patch is available for build {build}"
        )
    states = {}
    originals = {}
    with zipfile.ZipFile(archive) as source:
        for module_name, config in MODULES.items():
            entries = [
                entry for entry in source.infolist()
                if entry.filename == module_name
            ]
            if len(entries) != 1:
                raise CreationTransformPatchError(
                    f"Expected exactly one {module_name}"
                )
            states[module_name], originals[module_name] = inspect_member(
                source.read(entries[0]), config
            )
    unique = set(states.values())
    if unique == {"source"}:
        state = "source"
    elif unique == {"patched"}:
        state = "patched"
    else:
        # Every member has independently passed an exact source-or-current-
        # wrapper check. A mixture is therefore a safely upgradeable older
        # adapter set, including stages created before the Presets view member
        # was added.
        state = "outdated"
    return state, states, originals


def patch_archive(archive, build=BUILD):
    state, states, originals = inspect_archive(archive, build)
    if state in {"source", "outdated"}:
        replacements = {}
        for module_name, config in MODULES.items():
            _, adapter_path, installer, source_sentinel, adapter_sentinel = config
            if states[module_name] != "patched":
                replacements[module_name] = patched_member(
                    originals[module_name], adapter_path, installer,
                    source_sentinel, adapter_sentinel,
                )
        rewrite_archive(archive, replacements)
    if inspect_archive(archive, build)[0] != "patched":
        raise CreationTransformPatchError(
            "Creation transform patch verification failed"
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--build", type=int, default=BUILD)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise CreationTransformPatchError(
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
    except (CreationTransformPatchError, OSError, zipfile.BadZipFile) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        raise SystemExit(1)
