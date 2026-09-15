"""Verified prior-adapter upgrades and Windows transaction protections."""

from contextlib import ExitStack
import hashlib
import importlib.util
import json
import marshal
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

CLIENT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CLIENT_DIR))
import patch_frontier_industry_storage as patcher
import frontier_windows_client as windows


@unittest.skipUnless(sys.version_info[:2] == (3, 12), "Client bytecode requires Python 3.12")
class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.context = ExitStack()
        self.addCleanup(self.context.close)
        self.root = Path(self.context.enter_context(tempfile.TemporaryDirectory()))
        self.adapter = self.root / "adapter.py"
        self.adapter.write_text("def _evejs_install_industry_storage(namespace, kind):\n namespace['version'] = 1\n", encoding="utf-8")
        self.context.enter_context(mock.patch.object(patcher, "ADAPTER", self.adapter))
        self.profiles = {}
        self.originals = {}
        self.previous = {}
        previous_hashes = {}
        for name, (kind, _) in patcher.PROFILES.items():
            original = importlib.util.MAGIC_NUMBER + bytes(12) + marshal.dumps(compile(
                f"original_kind = {kind!r}\n", name, "exec"))
            self.originals[name] = original
            self.profiles[name] = (kind, hashlib.sha256(original).hexdigest())
            if kind in {"panel", "service", "assembly_window"}:
                self.previous[name] = original
            else:
                self.previous[name] = patcher.patched_member(original, kind)
                previous_hashes[kind] = hashlib.sha256(self.previous[name]).hexdigest()
        self.context.enter_context(mock.patch.object(patcher, "PROFILES", self.profiles))
        self.context.enter_context(mock.patch.object(patcher, "PREVIOUS_WRAPPER_SHA256", previous_hashes))
        self.adapter.write_text("def _evejs_install_industry_storage(namespace, kind):\n namespace['version'] = 1.5\n", encoding="utf-8")
        self.previous_panel = {}
        panel_hashes = {}
        for name, (kind, _) in self.profiles.items():
            member = self.originals[name] if kind in {"service", "assembly_window"} else patcher.patched_member(self.originals[name], kind)
            self.previous_panel[name] = member
            if kind not in {"service", "assembly_window"}:
                panel_hashes[kind] = hashlib.sha256(member).hexdigest()
        self.context.enter_context(mock.patch.object(patcher, "PREVIOUS_PANEL_WRAPPER_SHA256", panel_hashes))
        self.adapter.write_text("def _evejs_install_industry_storage(namespace, kind):\n namespace['version'] = 1.75\n", encoding="utf-8")
        self.previous_blueprint = {}
        blueprint_hashes = {}
        for name, (kind, _) in self.profiles.items():
            member = self.originals[name] if kind == "assembly_window" else patcher.patched_member(self.originals[name], kind)
            self.previous_blueprint[name] = member
            if kind != "assembly_window":
                blueprint_hashes[kind] = hashlib.sha256(member).hexdigest()
        self.context.enter_context(mock.patch.object(patcher, "PREVIOUS_BLUEPRINT_WRAPPER_SHA256", blueprint_hashes))
        self.adapter.write_text("def _evejs_install_industry_storage(namespace, kind):\n namespace['version'] = 2\n", encoding="utf-8")

    def archive(self, members=None):
        archive = self.root / "code.ccp"
        with zipfile.ZipFile(archive, "w") as target:
            target.comment = b"archive comment"
            for name, member in (members or self.previous).items():
                target.writestr(name, member)
            entry = zipfile.ZipInfo("unrelated.pyc", (2020, 1, 2, 3, 4, 6))
            entry.comment = b"member comment"
            entry.external_attr = 0o640 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            target.writestr(entry, b"untouched native bytecode")
        return archive

    def test_prior_three_wrappers_and_new_native_panel_upgrade_idempotently(self):
        archive = self.archive()
        state, states, originals = patcher.inspect_archive(archive)
        self.assertEqual(state, "outdated")
        self.assertEqual(set(states.values()), {"source", "outdated"})
        self.assertEqual(originals, self.originals)
        with zipfile.ZipFile(archive) as before:
            original_info = before.getinfo("unrelated.pyc")
        patcher.patch_archive(archive)
        self.assertEqual(patcher.inspect_archive(archive)[0], "patched")
        once = archive.read_bytes()
        patcher.patch_archive(archive)
        self.assertEqual(archive.read_bytes(), once)
        with zipfile.ZipFile(archive) as result:
            self.assertEqual(result.comment, b"archive comment")
            self.assertEqual(result.read("unrelated.pyc"), b"untouched native bytecode")
            for attribute in ("date_time", "comment", "external_attr", "compress_type"):
                self.assertEqual(getattr(result.getinfo("unrelated.pyc"), attribute), getattr(original_info, attribute))
            for name, (kind, expected) in self.profiles.items():
                state, original = patcher.inspect_member(result.read(name), kind, expected)
                self.assertEqual((state, original), ("patched", self.originals[name]))
                namespace = {}
                exec(marshal.loads(result.read(name)[16:]), namespace)
                self.assertEqual(namespace["version"], 2)
                self.assertEqual(namespace["original_kind"], kind)

    def test_unknown_or_tampered_wrapper_never_upgrades(self):
        name, (kind, expected) = next(iter(self.profiles.items()))
        original = self.originals[name]
        self.adapter.write_text("def _evejs_install_industry_storage(namespace, kind):\n namespace['version'] = 99\n", encoding="utf-8")
        unknown = patcher.patched_member(original, kind)
        self.adapter.write_text("def _evejs_install_industry_storage(namespace, kind):\n namespace['version'] = 2\n", encoding="utf-8")
        for invalid in (unknown, self.previous[name][:-1] + b"!"):
            with self.subTest(payload_hash=hashlib.sha256(invalid).hexdigest()):
                with self.assertRaises(patcher.IndustryStoragePatchError):
                    patcher.inspect_member(invalid, kind, expected)
                archive = self.archive({**self.previous, name: invalid})
                before = archive.read_bytes()
                with self.assertRaises(patcher.IndustryStoragePatchError):
                    patcher.patch_archive(archive)
                self.assertEqual(archive.read_bytes(), before)

    def test_previous_four_wrappers_and_native_service_upgrade_but_mixed_generations_do_not(self):
        archive = self.archive(self.previous_panel)
        self.assertEqual(patcher.inspect_archive(archive)[0], "outdated")
        patcher.patch_archive(archive)
        self.assertEqual(patcher.inspect_archive(archive)[0], "patched")
        first = next(iter(self.profiles))
        mixed = self.archive({**self.previous_panel, first: self.previous[first]})
        before = mixed.read_bytes()
        self.assertEqual(patcher.inspect_archive(mixed)[0], "partial")
        with self.assertRaisesRegex(patcher.IndustryStoragePatchError, "partially installed"):
            patcher.patch_archive(mixed)
        self.assertEqual(mixed.read_bytes(), before)

    def test_allowlisted_wrapper_still_requires_exact_embedded_original(self):
        name, (kind, expected) = next(iter(self.profiles.items()))
        wrapper = marshal.loads(self.previous[name][16:])
        invalid = self.previous[name][:16] + marshal.dumps(wrapper.replace(co_consts=tuple(
            b"incorrect original" if value == self.originals[name] else value for value in wrapper.co_consts)))
        with mock.patch.dict(patcher.PREVIOUS_WRAPPER_SHA256, {kind: hashlib.sha256(invalid).hexdigest()}):
            with self.assertRaises(patcher.IndustryStoragePatchError):
                patcher.inspect_member(invalid, kind, expected)

    def test_previous_five_wrappers_and_native_window_upgrade_without_mixing_releases(self):
        archive = self.archive(self.previous_blueprint)
        self.assertEqual(patcher.inspect_archive(archive)[0], "outdated")
        patcher.patch_archive(archive)
        self.assertEqual(patcher.inspect_archive(archive)[0], "patched")
        once = archive.read_bytes()
        patcher.patch_archive(archive)
        self.assertEqual(archive.read_bytes(), once)
        first = next(iter(self.profiles))
        mixed = self.archive({**self.previous_blueprint, first: self.previous_panel[first]})
        before = mixed.read_bytes()
        self.assertEqual(patcher.inspect_archive(mixed)[0], "partial")
        with self.assertRaisesRegex(patcher.IndustryStoragePatchError, "partially installed"):
            patcher.patch_archive(mixed)
        self.assertEqual(mixed.read_bytes(), before)

    def test_mixed_installations_fail_without_changing_archive(self):
        name, (kind, _) = next(iter(self.profiles.items()))
        for replacement in (self.originals[name], patcher.patched_member(self.originals[name], kind)):
            archive = self.archive({**self.previous, name: replacement})
            before = archive.read_bytes()
            self.assertEqual(patcher.inspect_archive(archive)[0], "partial")
            with self.assertRaisesRegex(patcher.IndustryStoragePatchError, "partially installed"):
                patcher.patch_archive(archive)
            self.assertEqual(archive.read_bytes(), before)

    def test_windows_upgrade_preserves_backup_and_rolls_back_each_late_failure(self):
        for failure in (None, "manifest", "validation"):
            with self.subTest(failure=failure):
                archive = self.archive()
                manifest = self.root / "manifest.dat"
                manifest.write_bytes(b"original manifest")
                marker_path = self.root / windows.STAGE_MARKER_NAME
                marker = {"build": 3502403, "nativeBlue": "blue.pyd", "patchState": "complete",
                          "clientPatchBackup": "retain-existing-backup",
                          "currentHashes": {"code.ccp": windows.sha256_file(archive), "manifest.dat": windows.sha256_file(manifest)}}
                marker_path.write_text(json.dumps(marker), encoding="utf-8")
                touched = [archive, manifest, marker_path]
                before = {path: path.read_bytes() for path in touched}
                checks = []

                def check(*_, **options):
                    checks.append(options)
                    state = patcher.inspect_archive(archive)[0]
                    self.assertEqual(state, "outdated" if len(checks) == 1 else "patched")
                    if len(checks) == 2 and failure == "validation":
                        raise windows.FrontierWindowsError("post-patch verification failed")
                    return {"valid": True}

                def refresh(*_):
                    manifest.write_bytes(b"refreshed manifest")
                    if failure == "manifest":
                        raise windows.FrontierWindowsError("manifest refresh failed")

                with mock.patch.object(windows, "check_stage", side_effect=check), \
                     mock.patch.object(windows, "load_stage", side_effect=lambda *_: (marker_path, windows.read_json(marker_path))), \
                     mock.patch.object(windows, "stage_paths", return_value={"code": archive, "manifest": manifest}), \
                     mock.patch.object(windows, "code_patch_states", side_effect=lambda *_: windows.expected_code_states(3502403, "patched") | {"industryStorage": patcher.inspect_archive(archive)[0]}), \
                     mock.patch.object(windows, "resolve_profile", return_value=(None, {})), \
                     mock.patch.object(windows, "run_python_patcher", side_effect=lambda *_args, **_kw: patcher.patch_archive(archive)), \
                     mock.patch.object(windows, "refresh_manifest_atomic", side_effect=refresh):
                    if failure:
                        with self.assertRaises(windows.FrontierWindowsError):
                            windows.patch_stage(self.root)
                        self.assertEqual({path: path.read_bytes() for path in touched}, before)
                        self.assertEqual(patcher.inspect_archive(archive)[0], "outdated")
                    else:
                        self.assertTrue(windows.patch_stage(self.root)["valid"])
                        saved = windows.read_json(marker_path)
                        self.assertEqual(saved["clientPatchBackup"], "retain-existing-backup")
                        self.assertEqual(saved["industryStoragePatchState"], "patched")
                        self.assertEqual(saved["currentHashes"]["code.ccp"], windows.sha256_file(archive))
                        self.assertEqual(saved["currentHashes"]["manifest.dat"], windows.sha256_file(manifest))
                        backup = Path(saved["industryStoragePatchBackup"])
                        for path in touched:
                            self.assertEqual((backup / path.name).read_bytes(), before[path])
                        after = {path: path.read_bytes() for path in touched}
                        self.assertTrue(windows.patch_stage(self.root)["valid"])
                        self.assertEqual({path: path.read_bytes() for path in touched}, after)
                self.assertTrue(checks[0]["allow_industry_storage_source"])
                self.assertTrue(checks[0]["allow_industry_storage_outdated"])
                self.assertTrue(checks[0]["allow_fitting_compatibility_source"])
                if len(checks) > 1:
                    self.assertNotIn("allow_industry_storage_outdated", checks[1])


class WindowsUpgradePreflightTests(unittest.TestCase):
    def test_default_check_rejects_old_adapter_and_upgrade_preflight_continues_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            keys = ("blue", "code", "manifest", "bundleMain", "bundleCertifi", "exefile", "startIni", "commonIni")
            paths = {key: root / key for key in keys}
            for path in paths.values():
                path.write_bytes(b"fixture")
            marker = {"build": 3502403, "nativeBlue": "blue.pyd"}
            states = windows.expected_code_states(3502403, "patched") | {"industryStorage": "outdated"}
            with mock.patch.object(windows, "load_stage", return_value=(root / windows.STAGE_MARKER_NAME, marker)), \
                 mock.patch.object(windows, "stage_paths", return_value=paths), \
                 mock.patch.object(windows, "assert_protected_stage_paths"), \
                 mock.patch.object(windows, "resolve_profile", return_value=(Path("profile.json"), {})), \
                 mock.patch.object(windows, "inspect_blue", return_value="target"), \
                 mock.patch.object(windows, "code_patch_states", return_value=states), \
                 mock.patch.object(windows, "verify_placebo", side_effect=RuntimeError("continued preflight validation")) as validation:
                for options in ({}, {"allow_industry_storage_source": True}):
                    with self.assertRaisesRegex(windows.FrontierWindowsError, "not fully enabled"):
                        windows.check_stage(root, **options)
                validation.assert_not_called()
                with self.assertRaisesRegex(RuntimeError, "continued preflight validation"):
                    windows.check_stage(root, allow_industry_storage_outdated=True)
                validation.assert_called_once()


@unittest.skipUnless(sys.version_info[:2] == (3, 12) and os.environ.get("EVE_FRONTIER_TEST_OUTDATED_ARCHIVE"),
                     "Set EVE_FRONTIER_TEST_OUTDATED_ARCHIVE to validate a real previous installation")
class InstalledUpgradeTests(unittest.TestCase):
    def test_verified_previous_installation_upgrades_in_a_temporary_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "code.ccp"
            with zipfile.ZipFile(os.environ["EVE_FRONTIER_TEST_OUTDATED_ARCHIVE"]) as source, zipfile.ZipFile(archive, "w") as target:
                for name in patcher.PROFILES:
                    target.writestr(name, source.read(name))
                target.writestr("unrelated.pyc", b"preserve exactly")
            self.assertEqual(patcher.inspect_archive(archive)[0], "outdated")
            patcher.patch_archive(archive)
            once = archive.read_bytes()
            self.assertEqual(patcher.inspect_archive(archive)[0], "patched")
            patcher.patch_archive(archive)
            self.assertEqual(archive.read_bytes(), once)
            with zipfile.ZipFile(archive) as result:
                self.assertEqual(result.read("unrelated.pyc"), b"preserve exactly")


if __name__ == "__main__":
    unittest.main()
