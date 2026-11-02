from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest import mock
import warnings
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import frontier_windows_client as core
import verify_2703993_stage as acceptance


class NativeDockingPolicyTests(unittest.TestCase):
    def test_exact_phase4_accepts_native_docking_and_preserves_the_feature_transition(self):
        with mock.patch.object(core, "run_python_patcher", side_effect=["native", "source"]):
            self.assertEqual(core.code_patch_states(Path("unused.ccp"), 2703993),
                             {"docking": "native", "features": "source"})
        with mock.patch.object(core, "run_python_patcher", side_effect=["native", "patched"]):
            self.assertEqual(core.code_patch_states(Path("unused.ccp"), 2703993),
                             {"docking": "native", "features": "patched"})
        self.assertEqual(core.expected_code_states(2703993, "patched"),
                         {"docking": "native", "features": "patched"})

    def test_modern_build_cannot_borrow_the_native_docking_exception(self):
        with mock.patch.object(core, "run_python_patcher", return_value="native"):
            with self.assertRaisesRegex(core.FrontierWindowsError, "station-docking"):
                core.code_patch_states(Path("unused.ccp"), 3502403)
        self.assertEqual(core.expected_code_states(3502403, "patched")["docking"], "patched")


def write_archive(path, entries, *, comment=b"preserved comment", entry_comment=b""):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(path, "w") as archive:
            archive.comment = comment
            for name, payload in entries:
                info = zipfile.ZipInfo(name, date_time=(2024, 10, 5, 12, 0, 0))
                info.comment = entry_comment
                archive.writestr(info, payload)


class ArchiveAcceptanceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="phase4 archive acceptance ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source.ccp"
        self.staged = self.root / "staged.ccp"
        self.entries = [(acceptance.DOCKING_MEMBER, b"native docking"),
                        ("duplicate.pyc", b"first duplicate"),
                        (acceptance.CHANGED_MEMBER, b"disabled feature"),
                        ("duplicate.pyc", b"second duplicate"), ("unrelated.pyc", b"unchanged")]
        self.patched = [(name, b"enabled feature" if name == acceptance.CHANGED_MEMBER else payload)
                        for name, payload in self.entries]
        write_archive(self.source, self.entries)
        write_archive(self.staged, self.patched)

    def test_compares_every_occurrence_including_duplicate_payloads(self):
        report = acceptance.compare_archives(self.source, self.staged)
        self.assertEqual(report["entries"], 5)
        self.assertEqual(report["uniqueNames"], 4)
        self.assertEqual(report["duplicateNames"], {"duplicate.pyc": 2})
        self.assertEqual(report["changedEntries"], [{"entry": 2, "name": acceptance.CHANGED_MEMBER}])
        self.assertTrue(report["nativeDockingUnchanged"])

    def test_changed_earlier_duplicate_cannot_hide_behind_an_unchanged_last_occurrence(self):
        self.patched[1] = ("duplicate.pyc", b"changed first duplicate")
        write_archive(self.staged, self.patched)
        with self.assertRaisesRegex(RuntimeError, "Unexpected ZIP content changes"):
            acceptance.compare_archives(self.source, self.staged)

    def test_docking_changes_are_rejected_even_when_the_feature_is_correct(self):
        self.patched[0] = (acceptance.DOCKING_MEMBER, b"changed docking")
        write_archive(self.staged, self.patched)
        with self.assertRaisesRegex(RuntimeError, "Unexpected ZIP content changes"):
            acceptance.compare_archives(self.source, self.staged)

    def test_extra_entries_and_changed_metadata_or_comment_are_rejected(self):
        write_archive(self.staged, [*self.patched, ("injected.pyc", b"extra")])
        with self.assertRaisesRegex(RuntimeError, "entry identities"):
            acceptance.compare_archives(self.source, self.staged)
        write_archive(self.staged, self.patched, entry_comment=b"changed")
        with self.assertRaisesRegex(RuntimeError, "entry metadata"):
            acceptance.compare_archives(self.source, self.staged)
        write_archive(self.staged, self.patched, comment=b"changed")
        with self.assertRaisesRegex(RuntimeError, "archive comment"):
            acceptance.compare_archives(self.source, self.staged)


class CacheCopyAcceptanceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="phase4 copied cache acceptance ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "retail" / "nebula"
        self.cache = self.source.parent / "ResFiles"
        self.stage = self.root / "stages" / "2703993"
        self.source.mkdir(parents=True)
        self.cache.mkdir()
        self.stage.mkdir(parents=True)
        lines = []
        for index, content in enumerate([b"static content", b"model content", b"another static"]):
            relative = f"aa/aa{index:02x}"
            target = self.cache / relative
            target.parent.mkdir(exist_ok=True)
            target.write_bytes(content)
            logical = f"res:/{'staticdata' if index != 1 else 'models'}/fixture{index}"
            lines.append(f"{logical},{relative},{hashlib.md5(content).hexdigest()},{len(content)},{len(content)}")
        (self.source / "resfileindex.txt").write_text("\n".join(lines) + "\n")
        shutil.copy2(self.source / "resfileindex.txt", self.stage / "resfileindex.txt")
        shutil.copytree(self.cache, self.stage / "ResFiles")
        self.marker = {"sourceRoot": str(self.source), "nativeBlue": "blue.pyd",
                       "resFiles": {"mode": "copy", "path": str(self.stage / "ResFiles"),
                                    "sourceTarget": str(self.cache)}}

    def test_full_hash_mode_verifies_each_indexed_copy_without_mutating_either_cache(self):
        before = {str(path.relative_to(self.root)): path.read_bytes()
                  for path in self.root.rglob("*") if path.is_file()}
        report = acceptance.cache_copy_report(self.stage, self.marker, verify_all=True)
        self.assertEqual(report["hashObjects"], 3)
        self.assertTrue(report["allIndexedHashesVerified"])
        self.assertTrue(report["noHardLinks"])
        self.assertEqual(before, {str(path.relative_to(self.root)): path.read_bytes()
                                  for path in self.root.rglob("*") if path.is_file()})

    def test_same_size_cache_corruption_fails_the_packaged_md5(self):
        file = self.stage / "ResFiles/aa/aa00"
        file.write_bytes(b"x" * file.stat().st_size)
        with self.assertRaisesRegex(RuntimeError, "resource MD5 mismatch"):
            acceptance.cache_copy_report(self.stage, self.marker, verify_all=True)

    def test_copy_mode_rejects_hard_links_to_the_official_cache(self):
        file = self.stage / "ResFiles/aa/aa00"
        file.unlink()
        os.link(self.cache / "aa/aa00", file)
        with self.assertRaisesRegex(RuntimeError, "hard link"):
            acceptance.cache_copy_report(self.stage, self.marker)

    def test_shared_cache_link_is_not_accepted_as_a_copy(self):
        self.marker["resFiles"]["mode"] = "junction"
        with self.assertRaisesRegex(RuntimeError, "copied cache"):
            acceptance.cache_copy_report(self.stage, self.marker)


if __name__ == "__main__":
    unittest.main()
