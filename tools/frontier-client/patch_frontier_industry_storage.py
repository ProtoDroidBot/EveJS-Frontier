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
    "frontier/industry/client/industry_svc.pyc": ("service", "6a75a99b60098ab4434cc9e4739e6193a301d5096d1d209a9728d4c4eb5bc40d"),
    "frontier/smart_assemblies/client/window/window.pyc": ("assembly_window", "a99b1764101b4ce954cb141c170094ddb044a2980d5d97ebda0702cb793d5f35"),
}
# Exact installed V1 wrappers, verified against the former adapter and their
# embedded retail originals before the Production-panel fix. No arbitrary
# wrapper containing a supported original is eligible for an upgrade.
PREVIOUS_WRAPPER_SHA256 = {
    "controller": "9bb1686f3c4e387ae0a46e45e6b75ef8945ad035c07debc618d261fe513c39cc",
    "facility": "8d86965fe00a6eb446b829df00f833fe5402d9f04b3743649db997bbade27706",
    "storage": "8215f10de2066199a8e49af13d8a69c730167d238d331e142a33171e251c396e",
}
# Exact four-member Production/SSU release, before blueprint synchronization.
PREVIOUS_PANEL_WRAPPER_SHA256 = {
    "controller": "193fb5cfaf559f365964ef13d1047689d48805fe2e9b4871a1cbba56b90b36c9",
    "facility": "b50e1d2a8dac24f52997af9c08cc6c2eef71317ba76402343b25ac796a0d01e4",
    "storage": "b00595dc1999b9a36b7ba806207381cbb7acbc6581fb7069da61c7d4ee57c13e",
    "panel": "9bec6f40df1a55737ab5c8dfa2279f2d7a2132e3e92a25f76199c1f26ff62f5c",
}
# Exact five-member blueprint synchronization release, before preserving ROOT
# when the native client opens an already-active Industry assembly again.
PREVIOUS_BLUEPRINT_WRAPPER_SHA256 = {
    "controller": "3e8be805c8e713d22c7b4df084d8f225ee5d186fd28eba9da475494d88c3a142",
    "facility": "e3d3c322c03dc52f1942d5abfd0c356f94932e0dbd2ecb389fd6c80b5535d6eb",
    "storage": "0475a28310b7f16a1b1c468905709299b4ce28c4c4de13f4bb70400a7276a8a0",
    "panel": "ba2b8f3992be4cb1e6b5829f069928d0b4e7d9059cd3064693e88a4bbc81fcdc",
    "service": "f6db984fb49f12b0db3f050d3bb173d106f866dd75573eed16b3074fa6d68204",
}
# Exact six-member assembly-window release, before direct SSU-to-SSU transfers
# and representative StorageInventoryItem identities were added.
PREVIOUS_WINDOW_WRAPPER_SHA256 = {
    "controller": "0aa58bb3f4281e3a2d26dbde9d62270ddd0b3a5c88f15bcb1b153fb5d716420b",
    "facility": "10109fa11cb34e8650bcd4dac3ab1e644ce55817e8cefa0ec9dbfb1ad753bf1d",
    "storage": "3cc189eeaa7798b95caae1393153660afb35b41521b014ffc561a5beb9857fe4",
    "panel": "3cf945f9417b949602a863e6c82314272fd6dc2cf56a141d2aea7096d6859875",
    "service": "fd7554eb2dde79f583389f3eec20224313907fcf70537b46e98e88aaf00b9775",
    "assembly_window": "99ad0ac3f1a346e5bb83830640b8c3f4a711067cbe70429a95f5500517dfcd40",
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
    previous = digest in (PREVIOUS_WRAPPER_SHA256.get(kind), PREVIOUS_PANEL_WRAPPER_SHA256.get(kind),
                          PREVIOUS_BLUEPRINT_WRAPPER_SHA256.get(kind),
                          PREVIOUS_WINDOW_WRAPPER_SHA256.get(kind))
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
    digests = {}
    with zipfile.ZipFile(archive) as source:
        for name, (kind, expected) in PROFILES.items():
            entries = [entry for entry in source.infolist() if entry.filename == name]
            if len(entries) != 1:
                raise IndustryStoragePatchError(f"Expected exactly one {name}")
            member = source.read(entries[0])
            digests[name] = hashlib.sha256(member).hexdigest()
            states[name], originals[name] = inspect_member(member, kind, expected)
    unique = set(states.values())
    for generation in (PREVIOUS_WRAPPER_SHA256, PREVIOUS_PANEL_WRAPPER_SHA256,
                       PREVIOUS_BLUEPRINT_WRAPPER_SHA256, PREVIOUS_WINDOW_WRAPPER_SHA256):
        if digests == {name: generation.get(kind, expected) for name, (kind, expected) in PROFILES.items()}:
            return "outdated", states, originals
    if "outdated" in unique:
        return "partial", states, originals
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
