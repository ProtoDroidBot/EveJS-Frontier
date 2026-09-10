from __future__ import annotations

import hashlib
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import frontier_windows_client as windows
import patch_frontier_blue_cache as cache_patch
from test_frontier_windows_client import make_pe_source, make_profile


class NativeCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="frontier native cache ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.client = self.root / "stillness"
        self.blue = self.client / "bin64/blue.pyd"
        self.cache = self.root / "ResFiles/5b/native_source"
        self.blue.parent.mkdir(parents=True)
        self.cache.parent.mkdir(parents=True)
        self.source = make_pe_source()
        self.blue.write_bytes(self.source)
        self.cache.write_bytes(self.source)
        (self.client / "start.ini").write_text("[main]\nbuild=9999999\nsync=9999999\nappname=FRONTIER\n")
        (self.client / "manifest.dat").write_bytes(b"untouched manifest")
        profile = make_profile(self.source)
        profile["resourceCache"] = {
            "logicalPath": "app:/bin64/blue.pyd",
            "cachePath": "5b/native_source",
            "sourceMd5": hashlib.md5(self.source).hexdigest(),
        }
        self.profile = profile
        self.profile_path = self.root / "blue-pyd.9999999.patch.json"
        self.profile_path.write_text(json.dumps(profile))
        self.index = self.root / "index_stillness.txt"
        self.index_data = (
            f"app:/bin64/blue.pyd,5b/native_source,{hashlib.md5(self.source).hexdigest()},{len(self.source)},42,33206\r\n"
        ).encode()
        self.index.write_bytes(self.index_data)

    def run_command(self, command, backup=None):
        return cache_patch.process_pair(command, self.client, 9999999, self.profile_path, backup)

    def test_check_has_no_side_effects(self):
        self.assertEqual(self.run_command("check")["state"], "source")
        self.assertFalse((self.root / ".evejs-backups").exists())
        self.assertEqual(self.blue.read_bytes(), self.source)

    def test_patch_backups_idempotence_and_restore(self):
        self.blue.chmod(0o640)
        self.cache.chmod(0o664)
        modes = [stat.S_IMODE(path.stat().st_mode) for path in (self.blue, self.cache)]
        report = self.run_command("patch")
        self.assertEqual(report["state"], "target")
        self.assertEqual(self.run_command("check")["state"], "target")
        self.assertEqual(self.blue.read_bytes(), self.cache.read_bytes())
        self.assertEqual([stat.S_IMODE(path.stat().st_mode) for path in (self.blue, self.cache)], modes)
        self.assertEqual(self.index.read_bytes(), self.index_data)
        self.assertEqual((self.client / "manifest.dat").read_bytes(), b"untouched manifest")
        backup = Path(report["backup"])
        self.assertEqual((backup / "stillness/bin64/blue.pyd").read_bytes(), self.source)
        self.assertEqual((backup / "ResFiles/5b/native_source").read_bytes(), self.source)
        self.assertTrue(self.run_command("patch")["alreadyPatched"])
        self.assertEqual(len(list((self.root / ".evejs-backups").iterdir())), 1)
        self.assertEqual(self.run_command("restore", backup)["state"], "source")
        self.assertEqual(self.blue.read_bytes(), self.source)
        self.assertEqual(self.cache.read_bytes(), self.source)

    def test_second_write_failure_rolls_back_both(self):
        real_patch = windows.patch_blue_atomic
        def fail_cache(path, profile):
            if path == self.cache:
                raise OSError("simulated cache failure")
            return real_patch(path, profile)
        with mock.patch.object(windows, "patch_blue_atomic", side_effect=fail_cache):
            with self.assertRaisesRegex(windows.FrontierWindowsError, "both files were restored"):
                self.run_command("patch")
        self.assertEqual(self.blue.read_bytes(), self.source)
        self.assertEqual(self.cache.read_bytes(), self.source)

    def test_post_backup_preflight_preserves_concurrent_changes(self):
        real_backup = windows.backup_transaction_files
        def change_after_backup(root, paths):
            result = real_backup(root, paths)
            self.cache.write_bytes(b"concurrent edit")
            return result
        with mock.patch.object(windows, "backup_transaction_files", side_effect=change_after_backup):
            with self.assertRaises(windows.FrontierWindowsError):
                self.run_command("patch")
        self.assertEqual(self.blue.read_bytes(), self.source)
        self.assertEqual(self.cache.read_bytes(), b"concurrent edit")

    def test_unknown_or_mixed_cache_fails_before_backup(self):
        for data in (b"unknown cache", windows.build_blue_target(self.source, self.profile)):
            self.cache.write_bytes(data)
            with self.assertRaisesRegex(windows.FrontierWindowsError, "mixed, partial, or unknown"):
                self.run_command("patch")
            self.assertFalse((self.root / ".evejs-backups").exists())
            self.assertEqual(self.blue.read_bytes(), self.source)

    def test_wrong_build_index_or_duplicate_entry_fails(self):
        with self.assertRaisesRegex(windows.FrontierWindowsError, "build/sync"):
            cache_patch.process_pair("patch", self.client, 3488090, self.profile_path)
        for data in (self.index_data.replace(b"5b/native_source", b"../blue.pyd"), self.index_data * 2):
            self.index.write_bytes(data)
            with self.assertRaises(windows.FrontierWindowsError):
                self.run_command("patch")
        self.assertFalse((self.root / ".evejs-backups").exists())

    def test_redirected_cache_fails(self):
        self.cache.unlink()
        self.cache.symlink_to(self.blue)
        with self.assertRaises(windows.FrontierWindowsError):
            self.run_command("patch")
        self.assertEqual(self.blue.read_bytes(), self.source)

    def test_corrupt_backup_prevents_any_restore(self):
        report = self.run_command("patch")
        backup = Path(report["backup"])
        (backup / "ResFiles/5b/native_source").write_bytes(b"corrupt backup")
        with self.assertRaisesRegex(windows.FrontierWindowsError, "Backup hash mismatch"):
            self.run_command("restore", backup)
        self.assertEqual(self.run_command("check")["state"], "target")

    def test_restore_recovers_known_mixed_pair_but_preserves_unknown_edits(self):
        report = self.run_command("patch")
        backup = Path(report["backup"])
        self.cache.write_bytes(self.source)
        self.assertEqual(self.run_command("restore", backup)["state"], "source")
        self.assertEqual(self.blue.read_bytes(), self.source)
        self.blue.write_bytes(b"unrelated edits")
        with self.assertRaisesRegex(windows.FrontierWindowsError, "refuses unknown"):
            self.run_command("restore", backup)
        self.assertEqual(self.blue.read_bytes(), b"unrelated edits")

    def test_3502403_profile_is_separate_and_exact(self):
        _, profile = windows.resolve_profile(3502403, "blue.pyd")
        _, old = windows.resolve_profile(3488090, "blue.pyd")
        self.assertEqual(profile["source"]["sha256"], "4ad88b947517e2f4f5d29c098fa78ed0f9d4d458db22096260a3e70e165a9cc0")
        self.assertNotEqual(profile["source"]["sha256"], old["source"]["sha256"])
        self.assertEqual(profile["target"], old["target"])
        self.assertEqual(profile["patches"], old["patches"])
        self.assertEqual(profile["resourceCache"]["cachePath"], "5b/5baa6098ac19f0c6_82cd35d6e53a59df73e4f82c847013c2")


if __name__ == "__main__":
    unittest.main()
