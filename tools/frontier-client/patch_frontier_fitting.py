#!/usr/bin/env python3
"""Install verified build-3502403 Frontier client compatibility adapters."""

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
MENU_MODULE_NAME = "eve/client/script/ui/services/menusvc.pyc"
MENU_SOURCE_MEMBER_SHA256 = "014f7513310f4027e6617befa0200d1dd1f0ab8a24c7e42529fb9d138961689f"
CREATION_SERVICE_MODULE_NAME = "frontier/creation/client/service.pyc"
CREATION_SERVICE_SOURCE_MEMBER_SHA256 = "55d9b955b0ab99fed39032db1580076946fb2e554c0ac8691eb7747d792f367c"
CREATION_SERVICE_PREVIOUS_WRAPPER_SHA256 = {
    "f51e3756cd36500b22833a8bf60519c52ba3b778f43390de1a994bb902dfbe8f",
}
ACTION_PROVIDER_MODULE_NAME = "frontier/creation/client/module_action_provider.pyc"
ACTION_PROVIDER_SOURCE_MEMBER_SHA256 = "fe9644684a5c001c6a6509461efcd4905f928c20937dcf6ab7fda813f13a3a5e"
ACTION_PROVIDER_PREVIOUS_WRAPPER_SHA256 = {
    "34fd2f715ff371190737025f185ca715e95593241bd62d7e346834dc7510c7fe",
}
ACTION_BAR_INTEGRATION_MODULE_NAME = "frontier/hud/action_bar/integration.pyc"
ACTION_BAR_INTEGRATION_SOURCE_MEMBER_SHA256 = "092f955e64a6ee6b89b54b395c77c8b9fe432af590fa9a22de210b72068363c4"
SKILLSHOT_CONTROLLER_MODULE_NAME = "frontier/skillshot/client/controller.pyc"
SKILLSHOT_CONTROLLER_SOURCE_MEMBER_SHA256 = "4c4162c18f4116b728755169581736ffc7984deb1c5d45cc6454e49dbeb81e75"
SKILLSHOT_AUTO_CANNON_MODULE_NAME = (
    "frontier/skillshot/client/mode/auto_cannon.pyc"
)
SKILLSHOT_AUTO_CANNON_SOURCE_MEMBER_SHA256 = "b4698b692cfb9c2af113b367b16aea3c5d1603e94b31415018c91460cecd538c"
PREVIOUS_WRAPPER_SHA256 = {
    "3a8b251364c9ca5dcf18f44518a5283869377f4781546885d916a57b8007910a",
    "74bd5fc669dbb04177083c1cdcb4350b3e2ba569a52208fd94b5f446b0c0f1e8",
    "0d79a1a445efe2fe3a6b44eb2afd093b40e0d6e2a9213b55cb520b0a1a7e3b56",
    "9eff822f5a7d4c432515d93e02501eaf2643649c3ff6ca576d917475a08559ca",
    "9774128683688cd11add071a654b0bb438ea4558d3989e93b2e71c94d8cff56d",
}
ADAPTER = Path(__file__).with_name("fitting_compatibility_adapter.py")
MENU_ADAPTER = Path(__file__).with_name("npc_fitting_menu_adapter.py")
CREATION_SERVICE_ADAPTER = Path(__file__).with_name(
    "creation_service_compatibility_adapter.py"
)
ACTION_PROVIDER_ADAPTER = Path(__file__).with_name(
    "action_bar_compatibility_adapter.py"
)
ACTION_BAR_INTEGRATION_ADAPTER = Path(__file__).with_name(
    "action_bar_selection_adapter.py"
)
SKILLSHOT_CONTROLLER_ADAPTER = Path(__file__).with_name(
    "skillshot_authority_controller_adapter.py"
)
SKILLSHOT_AUTO_CANNON_ADAPTER = Path(__file__).with_name(
    "skillshot_authority_auto_cannon_adapter.py"
)
SOURCE_SENTINEL = b"EVEJS_FITTING_ORIGINAL_MEMBER_V1"
ADAPTER_SENTINEL = b"EVEJS_FITTING_ADAPTER_CODE_V1"
MENU_SOURCE_SENTINEL = b"EVEJS_NPC_FITTING_MENU_ORIGINAL_MEMBER_V1"
MENU_ADAPTER_SENTINEL = b"EVEJS_NPC_FITTING_MENU_ADAPTER_CODE_V1"
CREATION_SERVICE_SOURCE_SENTINEL = b"EVEJS_CREATION_SERVICE_ORIGINAL_MEMBER_V1"
CREATION_SERVICE_ADAPTER_SENTINEL = b"EVEJS_CREATION_SERVICE_ADAPTER_CODE_V1"
ACTION_PROVIDER_SOURCE_SENTINEL = b"EVEJS_ACTION_PROVIDER_ORIGINAL_MEMBER_V1"
ACTION_PROVIDER_ADAPTER_SENTINEL = b"EVEJS_ACTION_PROVIDER_ADAPTER_CODE_V1"
ACTION_BAR_INTEGRATION_SOURCE_SENTINEL = (
    b"EVEJS_ACTION_BAR_INTEGRATION_ORIGINAL_MEMBER_V1"
)
ACTION_BAR_INTEGRATION_ADAPTER_SENTINEL = (
    b"EVEJS_ACTION_BAR_INTEGRATION_ADAPTER_CODE_V1"
)
SKILLSHOT_CONTROLLER_SOURCE_SENTINEL = (
    b"EVEJS_SKILLSHOT_CONTROLLER_ORIGINAL_MEMBER_V1"
)
SKILLSHOT_CONTROLLER_ADAPTER_SENTINEL = (
    b"EVEJS_SKILLSHOT_CONTROLLER_ADAPTER_CODE_V1"
)
SKILLSHOT_AUTO_CANNON_SOURCE_SENTINEL = (
    b"EVEJS_SKILLSHOT_AUTO_CANNON_ORIGINAL_MEMBER_V1"
)
SKILLSHOT_AUTO_CANNON_ADAPTER_SENTINEL = (
    b"EVEJS_SKILLSHOT_AUTO_CANNON_ADAPTER_CODE_V1"
)


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


def patched_menu_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        MENU_ADAPTER.read_text(encoding="utf-8"),
        "evejs/npc_fitting_menu_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_npc_fitting_menu_marshal\n"
        "exec(_evejs_npc_fitting_menu_marshal.loads(b'EVEJS_NPC_FITTING_MENU_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_npc_fitting_menu_marshal.loads(b'EVEJS_NPC_FITTING_MENU_ADAPTER_CODE_V1'))\n"
        "_evejs_install_npc_fitting_menu(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == MENU_SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == MENU_ADAPTER_SENTINEL
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


def patched_action_provider_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        ACTION_PROVIDER_ADAPTER.read_text(encoding="utf-8"),
        "evejs/action_bar_compatibility_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_action_provider_marshal\n"
        "exec(_evejs_action_provider_marshal.loads(b'EVEJS_ACTION_PROVIDER_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_action_provider_marshal.loads(b'EVEJS_ACTION_PROVIDER_ADAPTER_CODE_V1'))\n"
        "_evejs_install_action_bar_compatibility(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == ACTION_PROVIDER_SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == ACTION_PROVIDER_ADAPTER_SENTINEL
        else value
        for value in wrapper.co_consts
    )
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def patched_action_bar_integration_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        ACTION_BAR_INTEGRATION_ADAPTER.read_text(encoding="utf-8"),
        "evejs/action_bar_selection_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_action_bar_integration_marshal\n"
        "exec(_evejs_action_bar_integration_marshal.loads(b'EVEJS_ACTION_BAR_INTEGRATION_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_action_bar_integration_marshal.loads(b'EVEJS_ACTION_BAR_INTEGRATION_ADAPTER_CODE_V1'))\n"
        "_evejs_install_action_bar_selection(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == ACTION_BAR_INTEGRATION_SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == ACTION_BAR_INTEGRATION_ADAPTER_SENTINEL
        else value
        for value in wrapper.co_consts
    )
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def patched_skillshot_controller_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        SKILLSHOT_CONTROLLER_ADAPTER.read_text(encoding="utf-8"),
        "evejs/skillshot_authority_controller_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_skillshot_controller_marshal\n"
        "exec(_evejs_skillshot_controller_marshal.loads(b'EVEJS_SKILLSHOT_CONTROLLER_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_skillshot_controller_marshal.loads(b'EVEJS_SKILLSHOT_CONTROLLER_ADAPTER_CODE_V1'))\n"
        "_evejs_install_skillshot_authority(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == SKILLSHOT_CONTROLLER_SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == SKILLSHOT_CONTROLLER_ADAPTER_SENTINEL
        else value
        for value in wrapper.co_consts
    )
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def patched_skillshot_auto_cannon_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        SKILLSHOT_AUTO_CANNON_ADAPTER.read_text(encoding="utf-8"),
        "evejs/skillshot_authority_auto_cannon_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_skillshot_auto_cannon_marshal\n"
        "exec(_evejs_skillshot_auto_cannon_marshal.loads(b'EVEJS_SKILLSHOT_AUTO_CANNON_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_skillshot_auto_cannon_marshal.loads(b'EVEJS_SKILLSHOT_AUTO_CANNON_ADAPTER_CODE_V1'))\n"
        "_evejs_install_skillshot_auto_fire_authority(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == SKILLSHOT_AUTO_CANNON_SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == SKILLSHOT_AUTO_CANNON_ADAPTER_SENTINEL
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
        for module_name in (
            MODULE_NAME,
            MENU_MODULE_NAME,
            CREATION_SERVICE_MODULE_NAME,
            ACTION_PROVIDER_MODULE_NAME,
            ACTION_BAR_INTEGRATION_MODULE_NAME,
            SKILLSHOT_CONTROLLER_MODULE_NAME,
            SKILLSHOT_AUTO_CANNON_MODULE_NAME,
        ):
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
        menu_state, menu_original = inspect_member(
            source.read(entries_by_name[MENU_MODULE_NAME]),
            MENU_SOURCE_MEMBER_SHA256,
            patched_menu_member,
            set(),
        )
        service_state, service_original = inspect_member(
            source.read(entries_by_name[CREATION_SERVICE_MODULE_NAME]),
            CREATION_SERVICE_SOURCE_MEMBER_SHA256,
            patched_creation_service_member,
            CREATION_SERVICE_PREVIOUS_WRAPPER_SHA256,
        )
        action_provider_state, action_provider_original = inspect_member(
            source.read(entries_by_name[ACTION_PROVIDER_MODULE_NAME]),
            ACTION_PROVIDER_SOURCE_MEMBER_SHA256,
            patched_action_provider_member,
            ACTION_PROVIDER_PREVIOUS_WRAPPER_SHA256,
        )
        action_bar_integration_state, action_bar_integration_original = (
            inspect_member(
                source.read(entries_by_name[ACTION_BAR_INTEGRATION_MODULE_NAME]),
                ACTION_BAR_INTEGRATION_SOURCE_MEMBER_SHA256,
                patched_action_bar_integration_member,
                set(),
            )
        )
        skillshot_controller_state, skillshot_controller_original = inspect_member(
            source.read(entries_by_name[SKILLSHOT_CONTROLLER_MODULE_NAME]),
            SKILLSHOT_CONTROLLER_SOURCE_MEMBER_SHA256,
            patched_skillshot_controller_member,
            set(),
        )
        skillshot_auto_cannon_state, skillshot_auto_cannon_original = inspect_member(
            source.read(entries_by_name[SKILLSHOT_AUTO_CANNON_MODULE_NAME]),
            SKILLSHOT_AUTO_CANNON_SOURCE_MEMBER_SHA256,
            patched_skillshot_auto_cannon_member,
            set(),
        )

    states = {
        command_state,
        menu_state,
        service_state,
        action_provider_state,
        action_bar_integration_state,
        skillshot_controller_state,
        skillshot_auto_cannon_state,
    }
    if states == {"patched"}:
        state = "patched"
    elif states == {"source"}:
        state = "source"
    else:
        state = "outdated"
    return state, {
        MODULE_NAME: (command_state, command_original),
        MENU_MODULE_NAME: (menu_state, menu_original),
        CREATION_SERVICE_MODULE_NAME: (service_state, service_original),
        ACTION_PROVIDER_MODULE_NAME: (
            action_provider_state,
            action_provider_original,
        ),
        ACTION_BAR_INTEGRATION_MODULE_NAME: (
            action_bar_integration_state,
            action_bar_integration_original,
        ),
        SKILLSHOT_CONTROLLER_MODULE_NAME: (
            skillshot_controller_state,
            skillshot_controller_original,
        ),
        SKILLSHOT_AUTO_CANNON_MODULE_NAME: (
            skillshot_auto_cannon_state,
            skillshot_auto_cannon_original,
        ),
    }


def patch_archive(archive, build=BUILD):
    state, originals = inspect_archive(archive, build)
    if state in {"source", "outdated"}:
        replacements = {}
        command_state, command_original = originals[MODULE_NAME]
        if command_state != "patched":
            replacements[MODULE_NAME] = patched_member(command_original)
        menu_state, menu_original = originals[MENU_MODULE_NAME]
        if menu_state != "patched":
            replacements[MENU_MODULE_NAME] = patched_menu_member(menu_original)
        service_state, service_original = originals[CREATION_SERVICE_MODULE_NAME]
        if service_state != "patched":
            replacements[CREATION_SERVICE_MODULE_NAME] = (
                patched_creation_service_member(service_original)
            )
        action_provider_state, action_provider_original = originals[
            ACTION_PROVIDER_MODULE_NAME
        ]
        if action_provider_state != "patched":
            replacements[ACTION_PROVIDER_MODULE_NAME] = (
                patched_action_provider_member(action_provider_original)
            )
        action_bar_integration_state, action_bar_integration_original = originals[
            ACTION_BAR_INTEGRATION_MODULE_NAME
        ]
        if action_bar_integration_state != "patched":
            replacements[ACTION_BAR_INTEGRATION_MODULE_NAME] = (
                patched_action_bar_integration_member(
                    action_bar_integration_original
                )
            )
        skillshot_controller_state, skillshot_controller_original = originals[
            SKILLSHOT_CONTROLLER_MODULE_NAME
        ]
        if skillshot_controller_state != "patched":
            replacements[SKILLSHOT_CONTROLLER_MODULE_NAME] = (
                patched_skillshot_controller_member(skillshot_controller_original)
            )
        skillshot_auto_cannon_state, skillshot_auto_cannon_original = originals[
            SKILLSHOT_AUTO_CANNON_MODULE_NAME
        ]
        if skillshot_auto_cannon_state != "patched":
            replacements[SKILLSHOT_AUTO_CANNON_MODULE_NAME] = (
                patched_skillshot_auto_cannon_member(
                    skillshot_auto_cannon_original
                )
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
