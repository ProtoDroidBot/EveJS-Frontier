"""Exact Phase4 feature scope; real-bytecode checks require CPython 3.12."""
from __future__ import annotations

import dis
import json
import marshal
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

CLIENT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CLIENT_DIR))
import patch_frontier_features as features

BUILD = 2703993
MODULE = "frontier/beta.pyc"
FLAG = "FRONTIER_BETA_HIDE_SKILLS"
EVIDENCE = json.loads((CLIENT_DIR / "evidence/features.2703993.json").read_text())
CLIENT_ROOT = os.environ.get("EVEJS_FRONTIER_2703993_CLIENT_ROOT")


class Feature2703993ProfileTests(unittest.TestCase):
    def test_exact_registration_has_only_the_present_audited_legacy_switch(self):
        self.assertEqual(features.resolve_module_patches(BUILD), {MODULE: (FLAG,)})
        self.assertEqual(features.resolve_build_profile(BUILD), {MODULE: EVIDENCE["modules"][MODULE]["profile"]})
        self.assertNotIn("frontier/shell/common/const.pyc", features.resolve_build_profile(BUILD))
        for other in [2702949, 2703994]:
            with self.assertRaises(features.FeaturePatchError):
                features.resolve_build_profile(other)

    def test_evidence_preserves_legacy_restrictions_and_actual_server_services(self):
        source = EVIDENCE["modules"][MODULE]["sourceAssignments"]
        for name in ["FRONTIER_BETA_DISABLE_SCANNING", "FRONTIER_BETA_HIDE_DRONES_AND_FIGHTERS", "FRONTIER_BETA_HIDE_RIGS_AND_SUBSYSTEMS", "FRONTIER_BETA_HIDE_STRUCTURES", "FRONTIER_BETA_CLIENT_RANGE_BASED_OCCLUSION"]:
            self.assertIs(source[name], True)
        for name in EVIDENCE["scope"]["absentModernAssignments"]:
            self.assertNotIn(name, source)
        self.assertEqual(EVIDENCE["modules"][MODULE]["codeByteDifferences"], [27])
        self.assertEqual(EVIDENCE["modules"][MODULE]["selectedAssignments"], {FLAG: {"source": True, "patched": False}})
        root = CLIENT_DIR.parents[1]
        manager = (root / EVIDENCE["serverSupport"]["skillManager"]).read_text()
        for method in EVIDENCE["serverSupport"]["auditedManagerMethods"]:
            self.assertIn("Handle_" + method + "(", manager)
        handler = (root / EVIDENCE["serverSupport"]["skillHandler"]).read_text()
        self.assertIn("extends SkillMgrService", handler)


@unittest.skipUnless(sys.version_info[:2] == (3, 12) and CLIENT_ROOT,
                     "Requires CPython 3.12 and EVEJS_FRONTIER_2703993_CLIENT_ROOT")
class RealFeature2703993Tests(unittest.TestCase):
    def test_exact_one_byte_one_switch_and_tamper_rejection(self):
        archive = Path(CLIENT_ROOT) / "code.ccp"
        profile = features.resolve_build_profile(BUILD)
        patches = features.resolve_module_patches(BUILD)
        modules = features.load_modules(archive, patches)
        self.assertEqual(features.inspect_states(modules, profile, patches)[0], "source")
        member, code = modules[MODULE]
        expected = EVIDENCE["modules"][MODULE]
        assignments = features.find_assignments(code, tuple(expected["sourceAssignments"]))
        self.assertEqual({name: instruction.argval for name, instruction in assignments.items()}, expected["sourceAssignments"])
        patched_member = features.build_patched_member(MODULE, member, code, profile[MODULE], patches)
        patched_code = marshal.loads(patched_member[16:])
        self.assertEqual([i for i, (a, b) in enumerate(zip(code.co_code, patched_code.co_code)) if a != b], [27])
        changed = features.find_assignments(patched_code, tuple(expected["sourceAssignments"]))
        self.assertEqual({name: instruction.argval for name, instruction in changed.items()}, {**expected["sourceAssignments"], FLAG: False})
        self.assertEqual(features.inspect_module_state(MODULE, patched_member, patched_code, profile[MODULE], patches), "patched")
        for payload, inspected in [(member, code), (patched_member, patched_code)]:
            with self.assertRaises(features.FeaturePatchError):
                features.inspect_module_state(MODULE, payload[:8] + bytes([payload[8] ^ 1]) + payload[9:], inspected, profile[MODULE], patches)
            with self.assertRaises(features.FeaturePatchError):
                features.inspect_module_state(MODULE, payload + b"tamper", inspected, profile[MODULE], patches)
        with zipfile.ZipFile(archive) as source:
            for name in EVIDENCE["scope"]["absentModules"]:
                self.assertNotIn(name, source.namelist())

    def test_full_archive_copy_patch_check_idempotence_restore_keeps_source(self):
        source = Path(CLIENT_ROOT) / "code.ccp"
        source_hash = features.sha256_bytes(source.read_bytes())
        self.assertEqual(source_hash, EVIDENCE["source"]["archiveSHA256"])
        with tempfile.TemporaryDirectory(prefix="evejs-2703993-features-") as temporary:
            copy = Path(temporary) / "code.ccp"
            shutil.copy2(source, copy)
            command = [sys.executable, "-B", str(CLIENT_DIR / "patch_frontier_features.py"), "--archive", str(copy), "--build", str(BUILD)]
            self.assertEqual(subprocess.run(command + ["--check"], capture_output=True, text=True, check=True).stdout.strip(), "source")
            self.assertEqual(subprocess.run(command, capture_output=True, text=True, check=True).stdout.strip(), "patched")
            first_hash = features.sha256_bytes(copy.read_bytes())
            self.assertEqual(subprocess.run(command + ["--check"], capture_output=True, text=True, check=True).stdout.strip(), "patched")
            subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertEqual(features.sha256_bytes(copy.read_bytes()), first_hash)
            with zipfile.ZipFile(source) as before, zipfile.ZipFile(copy) as after:
                self.assertEqual(before.comment, after.comment)
                self.assertEqual(before.namelist(), after.namelist())
                for original, result in zip(before.infolist(), after.infolist()):
                    if original.filename != MODULE:
                        self.assertEqual(before.read(original), after.read(result), original.filename)
            shutil.copy2(source, copy)
            self.assertEqual(features.sha256_bytes(copy.read_bytes()), source_hash)
            self.assertEqual(subprocess.run(command + ["--check"], capture_output=True, text=True, check=True).stdout.strip(), "source")
        self.assertEqual(features.sha256_bytes(source.read_bytes()), source_hash)


if __name__ == "__main__":
    unittest.main()
