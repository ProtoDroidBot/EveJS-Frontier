"""Regression coverage for the build-3502403 map-view lifecycle patch."""

import hashlib
import importlib.util
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

import patch_frontier_map_view as patcher  # noqa: E402
import frontier_windows_client as windows  # noqa: E402


def member_for(code):
    return importlib.util.MAGIC_NUMBER + bytes(12) + marshal.dumps(code)


@unittest.skipUnless(
    sys.version_info[:2] == (3, 12), "Native code patch requires Python 3.12"
)
class MapViewPatchTests(unittest.TestCase):
    def test_patch_activates_brackets_before_changing_filter_mode(self):
        code = compile(
            "class BracketState:\n"
            " def __init__(self, active=False):\n"
            "  self._active = active\n"
            "  self.activations = 0\n"
            "  self.modes = []\n"
            " def activate(self):\n"
            "  self.activations += 1\n"
            "  self._active = True\n"
            " def set_bracket_filter_mode(self, mode):\n"
            "  if not self._active: raise AttributeError('uninitialized bracket source')\n"
            "  self.modes.append(mode)\n",
            "fixture.py",
            "exec",
        )
        source = member_for(code)
        expected = hashlib.sha256(source).hexdigest()
        patched = patcher.patched_member(source)
        self.assertEqual(patcher.inspect_member(source, expected)[0], "source")
        self.assertEqual(patcher.inspect_member(patched, expected)[0], "patched")

        namespace = {}
        exec(marshal.loads(patched[16:]), namespace)
        state = namespace["BracketState"]()
        state.set_bracket_filter_mode("system")
        state.set_bracket_filter_mode("default")
        self.assertEqual(state.activations, 1)
        self.assertEqual(state.modes, ["system", "default"])

        active_state = namespace["BracketState"](active=True)
        active_state.set_bracket_filter_mode("system")
        self.assertEqual(active_state.activations, 0)

    def test_tampered_and_unknown_members_fail_closed(self):
        code = compile("class BracketState: pass\n", "fixture.py", "exec")
        source = member_for(code)
        expected = hashlib.sha256(source).hexdigest()
        patched = patcher.patched_member(source)
        with self.assertRaises(patcher.MapViewPatchError):
            patcher.inspect_member(patched[:-1] + b"!", expected)
        with self.assertRaises(patcher.MapViewPatchError):
            patcher.inspect_archive(Path("unused"), 3502404)

    def test_completed_windows_stage_can_receive_map_patch_transactionally(self):
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                stage = Path(directory)
                code = stage / "code.ccp"
                manifest = stage / "manifest.dat"
                marker_path = stage / ".evejs-frontier-stage.json"
                code.write_bytes(b"existing verified client patches")
                manifest.write_bytes(b"original manifest")
                marker = {
                    "build": 3502403,
                    "nativeBlue": "blue.pyd",
                    "clientPatchBackup": "retain-existing-backup",
                    "currentHashes": {
                        "code.ccp": windows.sha256_file(code),
                        "manifest.dat": windows.sha256_file(manifest),
                    },
                }
                marker_path.write_text(str(marker), encoding="utf-8")
                original = {
                    path: path.read_bytes() for path in (code, manifest, marker_path)
                }
                checks = []

                def check(*_args, **options):
                    checks.append(options)
                    if len(checks) == 2 and fail:
                        raise windows.FrontierWindowsError("post-patch verification failed")
                    return {"valid": True}

                def run(script, *_args, **_kwargs):
                    self.assertEqual(script, windows.MAP_VIEW_PATCHER)
                    code.write_bytes(code.read_bytes() + b" plus map lifecycle")

                def refresh(*_args):
                    manifest.write_bytes(b"refreshed manifest")

                states = {
                    "docking": "patched",
                    "features": "patched",
                    "industryStorage": "patched",
                    "mapViewLifecycle": "source",
                }
                with (
                    mock.patch.object(windows, "check_stage", side_effect=check),
                    mock.patch.object(
                        windows, "load_stage", return_value=(marker_path, marker)
                    ),
                    mock.patch.object(
                        windows,
                        "stage_paths",
                        return_value={"code": code, "manifest": manifest},
                    ),
                    mock.patch.object(
                        windows, "code_patch_states", return_value=states
                    ),
                    mock.patch.object(
                        windows, "resolve_profile", return_value=(None, {})
                    ),
                    mock.patch.object(
                        windows, "run_python_patcher", side_effect=run
                    ),
                    mock.patch.object(
                        windows, "refresh_manifest_atomic", side_effect=refresh
                    ),
                ):
                    if fail:
                        with self.assertRaisesRegex(
                            windows.FrontierWindowsError,
                            "post-patch verification failed",
                        ):
                            windows.upgrade_industry_storage_stage(stage)
                        self.assertEqual(
                            {path: path.read_bytes() for path in original}, original
                        )
                    else:
                        self.assertTrue(
                            windows.upgrade_industry_storage_stage(stage)["valid"]
                        )
                        saved = windows.read_json(marker_path)
                        self.assertEqual(
                            saved["clientPatchBackup"], "retain-existing-backup"
                        )
                        self.assertEqual(
                            saved["mapViewLifecyclePatchState"], "patched"
                        )
                        backup = Path(saved["mapViewLifecyclePatchBackup"])
                        self.assertEqual(
                            (backup / "code.ccp").read_bytes(), original[code]
                        )
                self.assertTrue(checks[0]["allow_map_view_source"])
                self.assertNotIn("allow_map_view_source", checks[1])

    @unittest.skipUnless(
        os.environ.get("EVE_FRONTIER_TEST_ARCHIVE"),
        "Set EVE_FRONTIER_TEST_ARCHIVE for real bytecode validation",
    )
    def test_supported_archive_patch_is_idempotent_and_preserves_other_members(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "code.ccp"
            with zipfile.ZipFile(os.environ["EVE_FRONTIER_TEST_ARCHIVE"]) as source:
                member = source.read(patcher.MODULE_NAME)
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr(patcher.MODULE_NAME, member)
                archive.writestr("unrelated.pyc", b"preserve exactly")

            self.assertEqual(patcher.inspect_archive(archive_path)[0], "source")
            patcher.patch_archive(archive_path)
            once = archive_path.read_bytes()
            self.assertEqual(patcher.inspect_archive(archive_path)[0], "patched")
            patcher.patch_archive(archive_path)
            self.assertEqual(archive_path.read_bytes(), once)
            with zipfile.ZipFile(archive_path) as result:
                self.assertEqual(result.read("unrelated.pyc"), b"preserve exactly")


if __name__ == "__main__":
    unittest.main()
