#!/usr/bin/env python3
"""Install the verified Industry/SSU adapter into the supported client archive."""

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
ADAPTER = Path(__file__).with_name("industry_storage_adapter.py")
PROFILES = {
    "frontier/industry/client/ui/controller.pyc": ("controller", "4d09160ff67c023c2135a2fe0306d5dec9f6f01b9afaa19ed55a43639865d423"),
    "frontier/industry/client/facility.pyc": ("facility", "af9fcccdd843b3ceb3276f235cef7de588cfa25ff1d1223d072c8fc6d3d69abe"),
    "frontier/smart_assemblies/client/storage/smart_storage_inventory.pyc": ("storage", "51c2936c149ce051a1c5c5a183a4d6a86d743832834438bf968363e9a4a3e4ce"),
    "frontier/industry/client/ui/active_blueprint_panel.pyc": ("panel", "51ee3c0ef8afd74c4247a9dac9e9c9e69611962dd451282e7ddadd4aaa36ffbd"),
}
# Exact installed V1 wrappers, verified against the former adapter and their
# embedded retail originals before the Production-panel fix. No arbitrary
# wrapper containing a supported original is eligible for an upgrade.
PREVIOUS_WRAPPER_SHA256 = {
    "controller": "9bb1686f3c4e387ae0a46e45e6b75ef8945ad035c07debc618d261fe513c39cc",
    "facility": "8d86965fe00a6eb446b829df00f833fe5402d9f04b3743649db997bbade27706",
    "storage": "8215f10de2066199a8e49af13d8a69c730167d238d331e142a33171e251c396e",
}
SOURCE_SENTINEL = b"EVEJS_INDUSTRY_ORIGINAL_MEMBER_V1"
ADAPTER_SENTINEL = b"EVEJS_INDUSTRY_ADAPTER_CODE_V1"


class IndustryStoragePatchError(RuntimeError):
    pass


def patched_member(member, kind):
    original = marshal.loads(member[16:])
    adapter = compile(ADAPTER.read_text(encoding="utf-8"), "evejs/industry_storage_adapter.py", "exec", dont_inherit=True)
    wrapper = compile(
        "import marshal as _evejs_industry_marshal\n"
        "exec(_evejs_industry_marshal.loads(b'EVEJS_INDUSTRY_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_industry_marshal.loads(b'EVEJS_INDUSTRY_ADAPTER_CODE_V1'))\n"
        f"_evejs_install_industry_storage(globals(), {kind!r})\n",
        original.co_filename, "exec", dont_inherit=True,
    )
    constants = tuple(member if value == SOURCE_SENTINEL else marshal.dumps(adapter)
                      if value == ADAPTER_SENTINEL else value for value in wrapper.co_consts)
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def inspect_member(member, kind, expected):
    if len(member) < 16 or member[:4] != importlib.util.MAGIC_NUMBER:
        raise IndustryStoragePatchError("Unexpected Python bytecode header")
    digest = hashlib.sha256(member).hexdigest()
    if digest == expected:
        return "source", member
    previous = digest == PREVIOUS_WRAPPER_SHA256.get(kind)
    try:
        wrapper = marshal.loads(member[16:])
        if not isinstance(wrapper, types.CodeType):
            raise ValueError("Not a code object")
        originals = [value for value in wrapper.co_consts if isinstance(value, bytes)
                     and hashlib.sha256(value).hexdigest() == expected]
        if len(originals) == 1:
            if patched_member(originals[0], kind) == member:
                return "patched", originals[0]
            if previous:
                return "outdated", originals[0]
    except (ValueError, TypeError, EOFError):
        pass
    raise IndustryStoragePatchError("Module differs from the exact supported source or adapter")


def inspect_archive(archive, build=BUILD):
    if build != BUILD:
        raise IndustryStoragePatchError(f"No Industry storage adapter is available for build {build}")
    states = {}
    originals = {}
    with zipfile.ZipFile(archive) as source:
        for name, (kind, expected) in PROFILES.items():
            entries = [entry for entry in source.infolist() if entry.filename == name]
            if len(entries) != 1:
                raise IndustryStoragePatchError(f"Expected exactly one {name}")
            states[name], originals[name] = inspect_member(source.read(entries[0]), kind, expected)
    unique = set(states.values())
    previous_states = {
        name: "outdated" if kind in PREVIOUS_WRAPPER_SHA256 else "source"
        for name, (kind, _) in PROFILES.items()
    }
    if states == previous_states:
        return "outdated", states, originals
    return next(iter(unique)) if len(unique) == 1 else "partial", states, originals


def patch_archive(archive, build=BUILD):
    state, states, originals = inspect_archive(archive, build)
    if state == "partial":
        raise IndustryStoragePatchError("Industry storage adapter is only partially installed")
    if state in {"source", "outdated"}:
        rewrite_archive(archive, {name: patched_member(originals[name], PROFILES[name][0]) for name in states})
    if inspect_archive(archive, build)[0] != "patched":
        raise IndustryStoragePatchError("Industry storage adapter verification failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--build", type=int, default=BUILD)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        raise IndustryStoragePatchError("Python 3.12 exactly is required for client bytecode")
    if args.check:
        print(inspect_archive(args.archive, args.build)[0])
    else:
        patch_archive(args.archive, args.build)
        print("patched")


if __name__ == "__main__":
    try:
        main()
    except (IndustryStoragePatchError, OSError, zipfile.BadZipFile) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        raise SystemExit(1)
