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
PRIMARY_ACTION_MODULE_NAME = "frontier/hud/primary_action.pyc"
PRIMARY_ACTION_SOURCE_MEMBER_SHA256 = "75f678916ba0a728654b5cc10556f9e8daaf65a938cb621a5b8774c5dad7d3b1"
MENU_PREVIOUS_WRAPPER_SHA256 = {
    "f99291674b57057c633f68320da6ff96b61f54ea0d7e5731621431154b605bb5",
    "bb60780df4172697ac16be90fb901921b7e3a816691405b8b41965d9a8ccdc29",
    "730ddc9a29f376a3f653e5d36cd6259fce2a8c63423ef92e8f9069bde3815988",
    "0648949c86cd1dae56cca4c4750277d3a761027eebf1149642c016f6b4d2171f",
    "f6f1548bab7bebce8ae25041cb631f0667178783de345a782505a943ea0b8ef2",
    "f45b153b2e1844fe8d507a22d1da2d631e0e78400c7c7c938af4ea2b93193f9c",
    "aba3efbe9d2168c4971fec5db1b98842a9334c83c5c328c922de625309235a6c",
    "bff3c6014309496ca59508121dd480966d92e1da66577127898d4ed08f19b0a1",
    "d4dfec554b46c9be207a7e3f6aad582119ea63c827744ed1d9e4cabf6b874d89",
    "76110f82522eba598dbc3347225d94cb90efac8f365e0d9a00c2aee79eabe104",
    "83c76df85f5ac7d9c94c85fbd6360971313f065ca67ebdf44defd6eeb004f137",
    "229d2dfe2331ece15ef7820c59dc5409b936fac772daea97e74cd2e67c3e978e",
    "be7729c57fd91b4a612fce08cbfbab91ef8de66b7fa0d001f5afc8fa6cb7a294",
    "54d818b28984aa9451f8accd201283fc823ffac52947ee30d83704e5204a4824",
    "ce2d4ac6a029186b5c945ca870a2a15ac10baf33fc2f610a464669b73b89393f",
    "ebf9e0ecb83c9cdbb52e03071f84042e10757c50c6fa5ee327eb2c2ce989c66d",
    "7258d52810747642dc9ae7d7ec2f7dee997922f9ccc18772f5c67263bde212c5",
    "f42c7ff948948131f9f214c406389d273ee7000b55f088f2d1635d1e839f2183",
}
PRIMARY_ACTION_PREVIOUS_WRAPPER_SHA256 = {
    "32d02437a7ae19165894cfaef7a1bb8579cc8ef6ebf5967837aa677154254559",
    "904f31c0e62ee893cbaa0100c6756da15f8e4faa562e0049869889753eb70353",
    "5bccc0d07b755bc8296a5a1001d91ca520a433d5521177b780c20e4a730ba743",
    "b4ed357025fdf71d9951ad40043eb10b5c28fefc8827277fd620877f4312bca9",
    "a8e6cf6be2ae18eb63276f025d522f90d4652bcf79064e2815952dafdc8de32a",
    "b7e47edfda0c8fcc8c4f1cbed4def232c9dc296b7e0fe07e7b87f725a1f960db",
    "f965d1b89d64ef13eb298ab5a8465c4c24941bf8447aaea155ce2f61bfb27bc0",
    "4eb100d730206ffcf9a938d639c75ff2a47c471cd1156b56f8941365ab5dc56e",
    "13b680245e58ca5850076a343bfa79d9a5f3b63c3835084fae936584134f3401",
    "ebc6bea485b75345eac91d7e6c9395ff67fcdfe22169ae90d8f5bab9b171789b",
    "abdb6117d7b2beb1aa241096405b66ada61e3b4d1c7862b3603733dbdd91b979",
}
CREATION_SERVICE_MODULE_NAME = "frontier/creation/client/service.pyc"
CREATION_SERVICE_SOURCE_MEMBER_SHA256 = "55d9b955b0ab99fed39032db1580076946fb2e554c0ac8691eb7747d792f367c"
CREATION_SERVICE_PREVIOUS_WRAPPER_SHA256 = {
    "10ce31f99ddfd8061ccb88d07ffb938cf5110dcc20ef4bb52c11efe310c86d32",
    "f51e3756cd36500b22833a8bf60519c52ba3b778f43390de1a994bb902dfbe8f",
}
ACTION_PROVIDER_MODULE_NAME = "frontier/creation/client/module_action_provider.pyc"
ACTION_PROVIDER_SOURCE_MEMBER_SHA256 = "fe9644684a5c001c6a6509461efcd4905f928c20937dcf6ab7fda813f13a3a5e"
ACTION_PROVIDER_PREVIOUS_WRAPPER_SHA256 = {
    "6275cf9bb8ecd7c1618d7198a05c623ea49b1c9b77cd5cfea5728ada68a8ce60",
    "72dab66f740fa29c98c8ae8f34182cd69b18db1181e404182e6208f447c750e4",
    "34fd2f715ff371190737025f185ca715e95593241bd62d7e346834dc7510c7fe",
    "cd6775cf4eab24032c6d079b9211ac87bdc03ac45cca967db2b79b21bdbaebd4",
}
ACTION_BAR_INTEGRATION_MODULE_NAME = "frontier/hud/action_bar/integration.pyc"
ACTION_BAR_INTEGRATION_SOURCE_MEMBER_SHA256 = "092f955e64a6ee6b89b54b395c77c8b9fe432af590fa9a22de210b72068363c4"
ACTION_BAR_INTEGRATION_PREVIOUS_WRAPPER_SHA256 = {
    "3d0cae8e94184370c74c676634f330e4d2d6e8eecb481b2a6ca1c30f93018bed",
}
ACTION_BAR_SLOT_MODULE_NAME = "frontier/hud/action_bar/slot/ui.pyc"
ACTION_BAR_SLOT_SOURCE_MEMBER_SHA256 = "8e35c8469499c816c8c052922a9768e12821339c48c4fccb20524f4cd97ac435"
ACTION_BAR_SLOT_PREVIOUS_WRAPPER_SHA256 = {
    "5581c2fd975d1dda469a9949f4049174b661ba8876777d36234461f2de533876",
    "48f7f7967c2e50a8d734995b270608f0c24fcbc8849187251364da9a629fd320",
}
LEAP_HINT_MODULE_NAME = "frontier/hud/leap_hint.pyc"
LEAP_HINT_SOURCE_MEMBER_SHA256 = "b18124158bf3455fe87223d4e56b78ea79e0a15e7872a519614e84926df01af0"
SKILLSHOT_CONTROLLER_MODULE_NAME = "frontier/skillshot/client/controller.pyc"
SKILLSHOT_CONTROLLER_SOURCE_MEMBER_SHA256 = "4c4162c18f4116b728755169581736ffc7984deb1c5d45cc6454e49dbeb81e75"
SKILLSHOT_CONTROLLER_PREVIOUS_WRAPPER_SHA256 = {
    "e54131354ae0e00256158d3cf6f8e404cea8e6418ffbe5e15b1c67f5e9ac9e15",
}
SKILLSHOT_AUTO_CANNON_MODULE_NAME = (
    "frontier/skillshot/client/mode/auto_cannon.pyc"
)
SKILLSHOT_AUTO_CANNON_SOURCE_MEMBER_SHA256 = "b4698b692cfb9c2af113b367b16aea3c5d1603e94b31415018c91460cecd538c"
SKILLSHOT_AUTO_CANNON_PREVIOUS_WRAPPER_SHA256 = {
    "a5790102cb176a83c78c4d4b5238067769e298eeebe236c649e9dc4c26ca8ed5",
}
SKILLSHOT_HELD_BEAM_MODULE_NAME = "frontier/skillshot/client/mode/held_beam.pyc"
SKILLSHOT_HELD_BEAM_SOURCE_MEMBER_SHA256 = "bdca981a4054cdd13dca7988eb2322243259a787316236f42e60ddfb0d57427b"
PREVIOUS_WRAPPER_SHA256 = {
    "7bc9a9c35d68d5ae16afc2395f97393596a9b1f3bfb82199b556048b93bc8372",
    "2fe48420ddbeef27c039494a260aa287730306f23de75ae2cfa147a7bd6a3860",
    "9e2f068d69fa3c0c1b5e84b240743842f22ed1dcd5bce30059f5d5813a88b3d3",
    "41894b6c80d6f736a5037479dc1146e9d0a920f00e625e22b6ebd5506f58cdb1",
    "31e934d6fbc00a419c4e85a682d6505fc4beddc097c7dc5a93d4a210d5a62f4c",
    "5d2503d33a71f9f9e0b03b0da58d95b4da33fcbeed5ef6281c062a0a35642870",
    "5012d66efa24162040e00ef21a84cacfad86c34de9da2e11f4e47e454dd84d07",
    "1273c6c08296005679ddab9d98e8165445b5b313ccc8afba4934555363e84e45",
    "9f68a3cf01b21960d0d419df44ea857ffb0402991202102b3288ce90ac353739",
    "ef2347759d9456acebf258d6a8ce7b30f2c5eb6d6f93f49346ae53bd62e286f8",
    "3a8b251364c9ca5dcf18f44518a5283869377f4781546885d916a57b8007910a",
    "74bd5fc669dbb04177083c1cdcb4350b3e2ba569a52208fd94b5f446b0c0f1e8",
    "0d79a1a445efe2fe3a6b44eb2afd093b40e0d6e2a9213b55cb520b0a1a7e3b56",
    "9eff822f5a7d4c432515d93e02501eaf2643649c3ff6ca576d917475a08559ca",
    "9774128683688cd11add071a654b0bb438ea4558d3989e93b2e71c94d8cff56d",
}
ADAPTER = Path(__file__).with_name("fitting_compatibility_adapter.py")
MENU_ADAPTER = Path(__file__).with_name("npc_fitting_menu_adapter.py")
PRIMARY_ACTION_ADAPTER = Path(__file__).with_name("npc_primary_action_adapter.py")
CREATION_SERVICE_ADAPTER = Path(__file__).with_name(
    "creation_service_compatibility_adapter.py"
)
ACTION_PROVIDER_ADAPTER = Path(__file__).with_name(
    "action_bar_compatibility_adapter.py"
)
ACTION_BAR_INTEGRATION_ADAPTER = Path(__file__).with_name(
    "action_bar_selection_adapter.py"
)
ACTION_BAR_SLOT_ADAPTER = Path(__file__).with_name(
    "action_bar_deactivation_adapter.py"
)
LEAP_HINT_ADAPTER = Path(__file__).with_name(
    "leap_hint_compatibility_adapter.py"
)
SKILLSHOT_CONTROLLER_ADAPTER = Path(__file__).with_name(
    "skillshot_authority_controller_adapter.py"
)
SKILLSHOT_AUTO_CANNON_ADAPTER = Path(__file__).with_name(
    "skillshot_authority_auto_cannon_adapter.py"
)
SKILLSHOT_HELD_BEAM_ADAPTER = Path(__file__).with_name(
    "skillshot_held_beam_charge_adapter.py"
)
SOURCE_SENTINEL = b"EVEJS_FITTING_ORIGINAL_MEMBER_V1"
ADAPTER_SENTINEL = b"EVEJS_FITTING_ADAPTER_CODE_V1"
MENU_SOURCE_SENTINEL = b"EVEJS_NPC_FITTING_MENU_ORIGINAL_MEMBER_V1"
MENU_ADAPTER_SENTINEL = b"EVEJS_NPC_FITTING_MENU_ADAPTER_CODE_V1"
PRIMARY_ACTION_SOURCE_SENTINEL = b"EVEJS_NPC_PRIMARY_ACTION_ORIGINAL_MEMBER_V1"
PRIMARY_ACTION_ADAPTER_SENTINEL = b"EVEJS_NPC_PRIMARY_ACTION_ADAPTER_CODE_V1"
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
ACTION_BAR_SLOT_SOURCE_SENTINEL = b"EVEJS_ACTION_BAR_SLOT_ORIGINAL_MEMBER_V1"
ACTION_BAR_SLOT_ADAPTER_SENTINEL = b"EVEJS_ACTION_BAR_SLOT_ADAPTER_CODE_V1"
LEAP_HINT_SOURCE_SENTINEL = b"EVEJS_LEAP_HINT_ORIGINAL_MEMBER_V1"
LEAP_HINT_ADAPTER_SENTINEL = b"EVEJS_LEAP_HINT_ADAPTER_CODE_V1"
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
SKILLSHOT_HELD_BEAM_SOURCE_SENTINEL = (
    b"EVEJS_SKILLSHOT_HELD_BEAM_ORIGINAL_MEMBER_V1"
)
SKILLSHOT_HELD_BEAM_ADAPTER_SENTINEL = (
    b"EVEJS_SKILLSHOT_HELD_BEAM_ADAPTER_CODE_V1"
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


def patched_primary_action_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        PRIMARY_ACTION_ADAPTER.read_text(encoding="utf-8"),
        "evejs/npc_primary_action_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_npc_primary_action_marshal\n"
        "exec(_evejs_npc_primary_action_marshal.loads(b'EVEJS_NPC_PRIMARY_ACTION_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_npc_primary_action_marshal.loads(b'EVEJS_NPC_PRIMARY_ACTION_ADAPTER_CODE_V1'))\n"
        "_evejs_install_npc_primary_action(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == PRIMARY_ACTION_SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == PRIMARY_ACTION_ADAPTER_SENTINEL
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


def patched_action_bar_slot_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        ACTION_BAR_SLOT_ADAPTER.read_text(encoding="utf-8"),
        "evejs/action_bar_deactivation_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_action_bar_slot_marshal\n"
        "exec(_evejs_action_bar_slot_marshal.loads(b'EVEJS_ACTION_BAR_SLOT_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_action_bar_slot_marshal.loads(b'EVEJS_ACTION_BAR_SLOT_ADAPTER_CODE_V1'))\n"
        "_evejs_install_action_bar_deactivation(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == ACTION_BAR_SLOT_SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == ACTION_BAR_SLOT_ADAPTER_SENTINEL
        else value
        for value in wrapper.co_consts
    )
    return member[:16] + marshal.dumps(wrapper.replace(co_consts=constants))


def patched_leap_hint_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        LEAP_HINT_ADAPTER.read_text(encoding="utf-8"),
        "evejs/leap_hint_compatibility_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_leap_hint_marshal\n"
        "exec(_evejs_leap_hint_marshal.loads(b'EVEJS_LEAP_HINT_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_leap_hint_marshal.loads(b'EVEJS_LEAP_HINT_ADAPTER_CODE_V1'))\n"
        "_evejs_install_leap_hint_compatibility(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == LEAP_HINT_SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == LEAP_HINT_ADAPTER_SENTINEL
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


def patched_skillshot_held_beam_member(member):
    original = marshal.loads(member[16:])
    adapter = compile(
        SKILLSHOT_HELD_BEAM_ADAPTER.read_text(encoding="utf-8"),
        "evejs/skillshot_held_beam_charge_adapter.py",
        "exec",
        dont_inherit=True,
    )
    wrapper = compile(
        "import marshal as _evejs_skillshot_held_beam_marshal\n"
        "exec(_evejs_skillshot_held_beam_marshal.loads(b'EVEJS_SKILLSHOT_HELD_BEAM_ORIGINAL_MEMBER_V1'[16:]))\n"
        "exec(_evejs_skillshot_held_beam_marshal.loads(b'EVEJS_SKILLSHOT_HELD_BEAM_ADAPTER_CODE_V1'))\n"
        "_evejs_install_held_beam_charge_authority(globals())\n",
        original.co_filename,
        "exec",
        dont_inherit=True,
    )
    constants = tuple(
        member
        if value == SKILLSHOT_HELD_BEAM_SOURCE_SENTINEL
        else marshal.dumps(adapter)
        if value == SKILLSHOT_HELD_BEAM_ADAPTER_SENTINEL
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
        if len(originals) == 1 and build_patched_member(originals[0]) == member:
            return "patched", originals[0]
        if digest in previous_wrapper_sha256:
            if len(originals) == 1:
                return "outdated", originals[0]
            raise ValueError("Previous wrapper did not contain its retail original")
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
            PRIMARY_ACTION_MODULE_NAME,
            CREATION_SERVICE_MODULE_NAME,
            ACTION_PROVIDER_MODULE_NAME,
            ACTION_BAR_INTEGRATION_MODULE_NAME,
            ACTION_BAR_SLOT_MODULE_NAME,
            LEAP_HINT_MODULE_NAME,
            SKILLSHOT_CONTROLLER_MODULE_NAME,
            SKILLSHOT_AUTO_CANNON_MODULE_NAME,
            SKILLSHOT_HELD_BEAM_MODULE_NAME,
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
            MENU_PREVIOUS_WRAPPER_SHA256,
        )
        primary_action_state, primary_action_original = inspect_member(
            source.read(entries_by_name[PRIMARY_ACTION_MODULE_NAME]),
            PRIMARY_ACTION_SOURCE_MEMBER_SHA256,
            patched_primary_action_member,
            PRIMARY_ACTION_PREVIOUS_WRAPPER_SHA256,
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
                ACTION_BAR_INTEGRATION_PREVIOUS_WRAPPER_SHA256,
            )
        )
        action_bar_slot_state, action_bar_slot_original = inspect_member(
            source.read(entries_by_name[ACTION_BAR_SLOT_MODULE_NAME]),
            ACTION_BAR_SLOT_SOURCE_MEMBER_SHA256,
            patched_action_bar_slot_member,
            ACTION_BAR_SLOT_PREVIOUS_WRAPPER_SHA256,
        )
        leap_hint_state, leap_hint_original = inspect_member(
            source.read(entries_by_name[LEAP_HINT_MODULE_NAME]),
            LEAP_HINT_SOURCE_MEMBER_SHA256,
            patched_leap_hint_member,
            set(),
        )
        skillshot_controller_state, skillshot_controller_original = inspect_member(
            source.read(entries_by_name[SKILLSHOT_CONTROLLER_MODULE_NAME]),
            SKILLSHOT_CONTROLLER_SOURCE_MEMBER_SHA256,
            patched_skillshot_controller_member,
            SKILLSHOT_CONTROLLER_PREVIOUS_WRAPPER_SHA256,
        )
        skillshot_auto_cannon_state, skillshot_auto_cannon_original = inspect_member(
            source.read(entries_by_name[SKILLSHOT_AUTO_CANNON_MODULE_NAME]),
            SKILLSHOT_AUTO_CANNON_SOURCE_MEMBER_SHA256,
            patched_skillshot_auto_cannon_member,
            SKILLSHOT_AUTO_CANNON_PREVIOUS_WRAPPER_SHA256,
        )
        skillshot_held_beam_state, skillshot_held_beam_original = inspect_member(
            source.read(entries_by_name[SKILLSHOT_HELD_BEAM_MODULE_NAME]),
            SKILLSHOT_HELD_BEAM_SOURCE_MEMBER_SHA256,
            patched_skillshot_held_beam_member,
            set(),
        )

    states = {
        command_state,
        menu_state,
        primary_action_state,
        service_state,
        action_provider_state,
        action_bar_integration_state,
        action_bar_slot_state,
        leap_hint_state,
        skillshot_controller_state,
        skillshot_auto_cannon_state,
        skillshot_held_beam_state,
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
        PRIMARY_ACTION_MODULE_NAME: (
            primary_action_state,
            primary_action_original,
        ),
        CREATION_SERVICE_MODULE_NAME: (service_state, service_original),
        ACTION_PROVIDER_MODULE_NAME: (
            action_provider_state,
            action_provider_original,
        ),
        ACTION_BAR_INTEGRATION_MODULE_NAME: (
            action_bar_integration_state,
            action_bar_integration_original,
        ),
        ACTION_BAR_SLOT_MODULE_NAME: (
            action_bar_slot_state,
            action_bar_slot_original,
        ),
        LEAP_HINT_MODULE_NAME: (leap_hint_state, leap_hint_original),
        SKILLSHOT_CONTROLLER_MODULE_NAME: (
            skillshot_controller_state,
            skillshot_controller_original,
        ),
        SKILLSHOT_AUTO_CANNON_MODULE_NAME: (
            skillshot_auto_cannon_state,
            skillshot_auto_cannon_original,
        ),
        SKILLSHOT_HELD_BEAM_MODULE_NAME: (
            skillshot_held_beam_state,
            skillshot_held_beam_original,
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
        primary_action_state, primary_action_original = originals[
            PRIMARY_ACTION_MODULE_NAME
        ]
        if primary_action_state != "patched":
            replacements[PRIMARY_ACTION_MODULE_NAME] = (
                patched_primary_action_member(primary_action_original)
            )
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
        action_bar_slot_state, action_bar_slot_original = originals[
            ACTION_BAR_SLOT_MODULE_NAME
        ]
        if action_bar_slot_state != "patched":
            replacements[ACTION_BAR_SLOT_MODULE_NAME] = (
                patched_action_bar_slot_member(action_bar_slot_original)
            )
        leap_hint_state, leap_hint_original = originals[LEAP_HINT_MODULE_NAME]
        if leap_hint_state != "patched":
            replacements[LEAP_HINT_MODULE_NAME] = (
                patched_leap_hint_member(leap_hint_original)
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
        skillshot_held_beam_state, skillshot_held_beam_original = originals[
            SKILLSHOT_HELD_BEAM_MODULE_NAME
        ]
        if skillshot_held_beam_state != "patched":
            replacements[SKILLSHOT_HELD_BEAM_MODULE_NAME] = (
                patched_skillshot_held_beam_member(skillshot_held_beam_original)
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
