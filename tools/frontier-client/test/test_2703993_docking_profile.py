"""Exact native docking support; integration reads only supplied originals."""

from __future__ import annotations

import contextlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import patch_frontier_docking as docking


CLIENT_DIR = Path(__file__).resolve().parents[1]
SOURCE_ROOT = os.environ.get("EVEJS_FRONTIER_2703993_CLIENT_ROOT")


class NativeDockingProfileTests(unittest.TestCase):
    def test_native_profile_is_explicit_without_fabricated_patch_hashes(self):
        profile = docking.resolve_build_profile(2703993)
        self.assertEqual(profile["mode"], "native-enabled")
        self.assertEqual(profile["source_member_sha256"], "d7312451a7df2ca69cf75b0ca927e020f17855c96194859b225afb6e6470cb0b")
        self.assertEqual(profile["source_code_sha256"], "6fd1817d00417957cad19967ac5d20be51179cbadc3ef3b4625a050582ce2925")
        self.assertNotIn("patched_member_sha256", profile)
        self.assertNotIn("patched_code_sha256", profile)
        self.assertNotIn("mode", docking.resolve_build_profile(3502403))

    def test_native_state_pins_member_and_code_and_cannot_rewrite(self):
        code = compile("NATIVE_DOCKING = 'preserved'\n", "native-fixture.py", "exec")
        member = b"exact fixture header" + b"exact fixture payload"
        profile = {"mode": "native-enabled", "source_member_sha256": docking.sha256_bytes(member),
                   "source_code_sha256": docking.code_sha256(code)}
        self.assertEqual(docking.inspect_state(member, code, profile), "native")
        for altered in (member + b"extra", b"X" + member[1:]):
            with self.assertRaisesRegex(docking.DockingPatchError, "exact native-enabled source"):
                docking.inspect_state(altered, code, profile)
        with self.assertRaisesRegex(docking.DockingPatchError, "exact native-enabled source"):
            docking.inspect_state(member, code.replace(co_firstlineno=code.co_firstlineno + 1), profile)
        with self.assertRaisesRegex(docking.DockingPatchError, "requires no bytecode rewrite"):
            docking.build_patched_member(member, code, profile)

    def test_native_apply_does_not_invoke_archive_rewriter(self):
        code = compile("NATIVE_DOCKING = True\n", "native-fixture.py", "exec")
        member = b"exact fixture bytes"
        profile = {"mode": "native-enabled", "source_member_sha256": docking.sha256_bytes(member),
                   "source_code_sha256": docking.code_sha256(code)}
        for check in (False, True):
            arguments = ["patch_frontier_docking.py", "--archive", "unused-copy.ccp", "--build", "2703993"]
            if check:
                arguments.append("--check")
            output = io.StringIO()
            with mock.patch.object(sys, "argv", arguments), \
                    mock.patch.object(docking, "require_python_312"), \
                    mock.patch.object(docking, "resolve_build_profile", return_value=profile), \
                    mock.patch.object(docking, "load_module", return_value=(member, code)), \
                    mock.patch.object(docking, "rewrite_archive", side_effect=AssertionError("Native docking must not rewrite the archive")), \
                    contextlib.redirect_stdout(output):
                self.assertEqual(docking.main(), 0)
            self.assertEqual(output.getvalue().strip(), "native")


@unittest.skipUnless(sys.version_info[:2] == (3, 12) and SOURCE_ROOT,
                     "Requires Python 3.12 and EVEJS_FRONTIER_2703993_CLIENT_ROOT.")
class Exact2703993DockingTests(unittest.TestCase):
    def setUp(self):
        self.archive = Path(SOURCE_ROOT) / "code.ccp"
        self.profile = docking.resolve_build_profile(2703993)
        self.member, self.code = docking.load_module(self.archive)
        self.assertEqual(docking.inspect_state(self.member, self.code, self.profile), "native")

    def test_real_archive_copy_is_unchanged_by_check_apply_and_repeat_apply(self):
        source_hash = docking.sha256_bytes(self.archive.read_bytes())
        self.assertEqual(source_hash, self.profile["source_archive_sha256"])
        with tempfile.TemporaryDirectory(prefix="2703993 native docking copy ") as temporary:
            copied = Path(temporary) / "code.ccp"
            shutil.copy2(self.archive, copied)
            original_mtime = copied.stat().st_mtime_ns
            command = [sys.executable, "-B", str(CLIENT_DIR / "patch_frontier_docking.py"),
                       "--archive", str(copied), "--build", "2703993"]
            for flags in (["--check"], [], [], ["--check"]):
                result = subprocess.run(command + flags, capture_output=True, text=True, check=True)
                self.assertEqual(result.stdout.strip(), "native")
                self.assertEqual(docking.sha256_bytes(copied.read_bytes()), source_hash)
                self.assertEqual(copied.stat().st_mtime_ns, original_mtime)
            self.assertEqual(sorted(path.name for path in copied.parent.iterdir()), ["code.ccp"])
        self.assertEqual(docking.sha256_bytes(self.archive.read_bytes()), source_hash)

    def test_mutated_member_is_rejected_before_any_archive_write(self):
        with tempfile.TemporaryDirectory(prefix="2703993 docking unknown copy ") as temporary:
            copied = Path(temporary) / "code.ccp"
            with zipfile.ZipFile(copied, "w") as archive:
                archive.writestr(docking.MODULE_NAME, self.member[:8] + b"\x01" + self.member[9:])
                archive.writestr("unrelated/resource", b"preserved")
            original_hash = docking.sha256_bytes(copied.read_bytes())
            command = [sys.executable, "-B", str(CLIENT_DIR / "patch_frontier_docking.py"),
                       "--archive", str(copied), "--build", "2703993"]
            for flags in (["--check"], []):
                result = subprocess.run(command + flags, capture_output=True, text=True)
                self.assertEqual(result.returncode, 1)
                self.assertIn("not the exact native-enabled source", result.stderr)
                self.assertEqual(docking.sha256_bytes(copied.read_bytes()), original_hash)
            self.assertEqual(sorted(path.name for path in copied.parent.iterdir()), ["code.ccp"])

    def test_native_docking_predicates_keep_original_conditions(self):
        def descendants(code):
            yield code
            for constant in code.co_consts:
                if isinstance(constant, types.CodeType):
                    yield from descendants(constant)

        methods = {code.co_qualname: code for code in descendants(self.code)}
        self.assertFalse(any("DOCKING_DISABLED" in code.co_names for code in methods.values()))
        is_dockable = types.FunctionType(methods["CelestialChecker.IsDockable"], {})
        offer_dock = types.FunctionType(methods["CelestialChecker.OfferDock"], {})
        # A station takes the native short-circuit path without querying a
        # structure predicate that is irrelevant to this menu entry.
        def unexpected_structure_query():
            raise AssertionError("Station docking must not query structure docking")
        self.assertTrue(is_dockable(types.SimpleNamespace(IsStation=lambda: True,
                                                         IsDockableStructure=unexpected_structure_query)))
        self.assertTrue(is_dockable(types.SimpleNamespace(IsStation=lambda: False, IsDockableStructure=lambda: True)))
        self.assertFalse(is_dockable(types.SimpleNamespace(IsStation=lambda: False, IsDockableStructure=lambda: False)))

        def checker(dockable=True, in_space=True, warping=False, distance=500, structure=False, online=True):
            return types.SimpleNamespace(IsDockable=lambda: dockable,
                session=types.SimpleNamespace(IsPilotInShipInSpace=lambda: in_space, isPilotWarping=lambda: warping),
                getDistanceToActiveShip=lambda: distance, IsStructure=lambda: structure, IsStructureOnline=lambda: online)
        self.assertTrue(offer_dock(checker()))
        self.assertFalse(offer_dock(checker(dockable=False)))
        self.assertFalse(offer_dock(checker(in_space=False)))
        self.assertFalse(offer_dock(checker(warping=True)))
        self.assertIsNone(offer_dock(checker(distance=None)))
        self.assertFalse(offer_dock(checker(structure=True, online=False)))
        self.assertTrue(offer_dock(checker(structure=True, online=True)))


if __name__ == "__main__":
    unittest.main()
