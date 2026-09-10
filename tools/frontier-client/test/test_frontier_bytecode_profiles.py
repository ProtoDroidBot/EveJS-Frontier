"""Exact bytecode profiles; optional integration uses a read-only client archive.

Run with Python 3.12 and EVE_FRONTIER_TEST_ARCHIVE pointing to build 3502403's
unmodified code.ccp to exercise the real modules. Rewrites use temporary files.
"""

from __future__ import annotations

import dis
import importlib.util
import marshal
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


CLIENT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CLIENT_DIR))

import patch_frontier_docking as docking  # noqa: E402
import patch_frontier_features as features  # noqa: E402


BUILD = 3502403
ARCHIVE = os.environ.get("EVE_FRONTIER_TEST_ARCHIVE")


def member_for(code):
    return importlib.util.MAGIC_NUMBER + bytes(12) + marshal.dumps(code)


def profile_for(module, source, patched):
    return {
        "source_member_sha256": module.sha256_bytes(member_for(source)),
        "source_code_sha256": module.code_sha256(source),
        "patched_member_sha256": module.sha256_bytes(member_for(patched)),
        "patched_code_sha256": module.code_sha256(patched),
    }


class BytecodeProfileTests(unittest.TestCase):
    def test_current_build_and_legacy_profiles_are_explicit(self):
        self.assertEqual(docking.DEFAULT_CLIENT_BUILD, BUILD)
        self.assertEqual(features.DEFAULT_CLIENT_BUILD, BUILD)
        self.assertIn(3474408, docking.BUILD_PROFILES)
        self.assertIn(3488090, docking.BUILD_PROFILES)
        self.assertIn(3467658, features.BUILD_PROFILES)
        self.assertIn(3474408, features.BUILD_PROFILES)
        self.assertIn(3488090, features.BUILD_PROFILES)
        for build in features.BUILD_PROFILES:
            self.assertEqual(
                set(features.resolve_build_profile(build)),
                set(features.resolve_module_patches(build)),
            )
        for module_name, profile in features.resolve_build_profile(BUILD).items():
            old = features.resolve_build_profile(3488090)[module_name]
            self.assertEqual(profile["source_code_sha256"], old["source_code_sha256"])
            self.assertNotEqual(profile["source_member_sha256"], old["source_member_sha256"])
        self.assertEqual(
            features.resolve_module_patches(BUILD)["frontier/shell/common/const.pyc"],
            ("HIDE_SHELL_IMPLANT_SYSTEM",),
        )

    def test_unknown_builds_fail_closed(self):
        with self.assertRaises(docking.DockingPatchError):
            docking.resolve_build_profile(3502404)
        with self.assertRaises(features.FeaturePatchError):
            features.resolve_build_profile(3502404)
        with self.assertRaises(features.FeaturePatchError):
            features.resolve_module_patches(3502404)

    def test_docking_requires_exact_source_and_patched_members(self):
        code = compile("DOCKING_DISABLED = True\n", "fixture.py", "exec")
        instruction = docking.find_docking_constant(code)
        constants = list(code.co_consts)
        constants[instruction.arg] = False
        patched = code.replace(co_consts=tuple(constants))
        profile = profile_for(docking, code, patched)
        member = member_for(code)
        self.assertEqual(docking.inspect_state(member, code, profile), "source")
        patched_member = docking.build_patched_member(member, code, profile)
        self.assertEqual(docking.inspect_state(patched_member, patched, profile), "patched")
        for checked_member, checked_code in ((member, code), (patched_member, patched)):
            changed_header = checked_member[:8] + b"\x01" + checked_member[9:]
            with self.assertRaises(docking.DockingPatchError):
                docking.inspect_state(changed_header, checked_code, profile)

    def test_feature_patch_preserves_unselected_true_assignments(self):
        name = "fixture.pyc"
        patches = {name: ("HIDE_SUPPORTED",)}
        code = compile(
            "HIDE_SUPPORTED = True\nHIDE_UNSUPPORTED = True\nALREADY_VISIBLE = False\n",
            "fixture.py",
            "exec",
        )
        assignments = features.find_assignments(code, patches[name])
        false_index = next(i for i, value in enumerate(code.co_consts) if value is False)
        bytecode = bytearray(code.co_code)
        bytecode[assignments["HIDE_SUPPORTED"].offset + 1] = false_index
        patched = code.replace(co_code=bytes(bytecode), co_consts=tuple(list(code.co_consts)))
        profile = profile_for(features, code, patched)
        member = member_for(code)
        patched_member = features.build_patched_member(name, member, code, profile, patches)
        patched_code = marshal.loads(patched_member[16:])
        inspected = features.find_assignments(
            patched_code, ("HIDE_SUPPORTED", "HIDE_UNSUPPORTED", "ALREADY_VISIBLE")
        )
        self.assertIs(inspected["HIDE_SUPPORTED"].argval, False)
        self.assertIs(inspected["HIDE_UNSUPPORTED"].argval, True)
        self.assertIs(inspected["ALREADY_VISIBLE"].argval, False)
        self.assertEqual(
            features.inspect_module_state(name, patched_member, patched_code, profile, patches),
            "patched",
        )
        with self.assertRaises(features.FeaturePatchError):
            features.inspect_module_state(
                name, patched_member + b"unexpected", patched_code, profile, patches
            )


@unittest.skipUnless(
    sys.version_info[:2] == (3, 12) and ARCHIVE,
    "Requires Python 3.12 and EVE_FRONTIER_TEST_ARCHIVE for build 3502403",
)
class Build3502403ArchiveTests(unittest.TestCase):
    def test_exact_source_patch_roundtrip_and_idempotence_in_temporary_archive(self):
        archive_path = Path(ARCHIVE)
        source_digest = docking.sha256_bytes(archive_path.read_bytes())
        member, code = docking.load_module(archive_path)
        docking_profile = docking.resolve_build_profile(BUILD)
        self.assertEqual(docking.inspect_state(member, code, docking_profile), "source")
        # Replacing this constant must affect only the docking assignment.
        docking_instruction = docking.find_docking_constant(code)
        self.assertEqual(
            [i.offset for i in dis.get_instructions(code)
             if i.opname == "LOAD_CONST" and i.arg == docking_instruction.arg],
            [docking_instruction.offset],
        )
        module_patches = features.resolve_module_patches(BUILD)
        modules = features.load_modules(archive_path, module_patches)
        feature_profile = features.resolve_build_profile(BUILD)
        self.assertEqual(
            features.inspect_states(modules, feature_profile, module_patches)[0], "source"
        )
        shell_code = modules["frontier/shell/common/const.pyc"][1]
        self.assertIs(
            features.find_assignments(shell_code, ("HIDE_SHELL_RAIMENT_SYSTEM",))[
                "HIDE_SHELL_RAIMENT_SYSTEM"
            ].argval,
            False,
        )
        with tempfile.TemporaryDirectory(prefix="frontier bytecode 3502403 ") as raw:
            fixture = Path(raw) / "code.ccp"
            with zipfile.ZipFile(fixture, "w") as archive:
                archive.comment = b"Preserve archive metadata"
                archive.writestr(docking.MODULE_NAME, member)
                for name, (feature_member, _code) in modules.items():
                    archive.writestr(name, feature_member)
                archive.writestr("unrelated/resource", b"unchanged")
            for script in ("patch_frontier_docking.py", "patch_frontier_features.py"):
                command = [sys.executable, str(CLIENT_DIR / script), "--archive", str(fixture)]
                patched = subprocess.run(command, capture_output=True, text=True, check=True)
                self.assertEqual(patched.stdout.strip(), "patched")
                first_digest = docking.sha256_bytes(fixture.read_bytes())
                subprocess.run(command, capture_output=True, text=True, check=True)
                self.assertEqual(docking.sha256_bytes(fixture.read_bytes()), first_digest)
                checked = subprocess.run(command + ["--check"], capture_output=True, text=True, check=True)
                self.assertEqual(checked.stdout.strip(), "patched")
            with zipfile.ZipFile(fixture) as archive:
                self.assertEqual(archive.comment, b"Preserve archive metadata")
                self.assertEqual(archive.read("unrelated/resource"), b"unchanged")
        self.assertEqual(docking.sha256_bytes(archive_path.read_bytes()), source_digest)


if __name__ == "__main__":
    unittest.main()
