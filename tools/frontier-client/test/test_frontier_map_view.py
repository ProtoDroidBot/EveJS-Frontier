"""Regression coverage for the build-3502403 Frontier system-view patches."""

import hashlib
import importlib.util
import marshal
import os
from pathlib import Path
import sys
import tempfile
import types
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
    def system_view_modules(self):
        resolved_module = types.ModuleType(
            "frontier.crdata.client.resolved_celestial"
        )
        system_module = types.ModuleType(
            "frontier.hud.system_view.scene_new.area_controller.system"
        )

        class ResolvedDungeon:
            pass

        class SystemAreaController:
            def _is_bracket_visible(self, resolved_celestial, selected_key):
                return "retail-result"

        resolved_module.ResolvedDungeon = ResolvedDungeon
        system_module.SystemAreaController = SystemAreaController
        return {
            resolved_module.__name__: resolved_module,
            system_module.__name__: system_module,
        }, ResolvedDungeon, SystemAreaController

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

        modules, _, _ = self.system_view_modules()
        namespace = {
            "BallparkBracketSource": type(
                "BallparkBracketSource", (), {"_prime": lambda self: None}
            ),
        }
        with mock.patch.dict(sys.modules, modules):
            exec(marshal.loads(patched[16:]), namespace)
            state = namespace["BracketState"]()
            state.set_bracket_filter_mode("system")
            state.set_bracket_filter_mode("default")
        self.assertEqual(state.activations, 1)
        self.assertEqual(state.modes, ["system", "default"])

        active_state = namespace["BracketState"](active=True)
        with mock.patch.dict(sys.modules, modules):
            active_state.set_bracket_filter_mode("system")
        self.assertEqual(active_state.activations, 0)

    def test_patch_admits_every_resolved_dungeon_to_system_view(self):
        code = compile(
            "class BracketState:\n"
            " def __init__(self): self._active = True\n"
            " def set_bracket_filter_mode(self, mode): return mode\n",
            "fixture.py",
            "exec",
        )
        modules, ResolvedDungeon, SystemAreaController = self.system_view_modules()
        namespace = {
            "BallparkBracketSource": type(
                "BallparkBracketSource", (), {"_prime": lambda self: None}
            ),
        }
        with mock.patch.dict(sys.modules, modules):
            exec(marshal.loads(patcher.patched_member(member_for(code))[16:]), namespace)
            state = namespace["BracketState"]()
            self.assertEqual(state.set_bracket_filter_mode("system"), "system")

        area = SystemAreaController()
        self.assertIs(
            area._is_bracket_visible(ResolvedDungeon(), selected_key=None),
            True,
        )
        self.assertEqual(
            area._is_bracket_visible(object(), selected_key=None),
            "retail-result",
        )

        # Re-entering the view must not stack wrappers.
        patched_method = SystemAreaController._is_bracket_visible
        with mock.patch.dict(sys.modules, modules):
            state.set_bracket_filter_mode("system")
        self.assertIs(SystemAreaController._is_bracket_visible, patched_method)

    def test_docked_system_view_does_not_wait_for_a_ballpark(self):
        code = compile(
            "class BracketState:\n"
            " def set_bracket_filter_mode(self, mode): return mode\n",
            "fixture.py",
            "exec",
        )

        class Michelle:
            ballpark = None
            fail = False

            def GetBallpark(self):
                if self.fail:
                    raise RuntimeError("ballpark is unavailable")
                return self.ballpark

        class BallparkBracketSource:
            def __init__(self, michelle):
                self._michelle = michelle
                self.prime_count = 0

            def _prime(self):
                self.prime_count += 1

        client_session = types.SimpleNamespace(stationid2=60000001)
        namespace = {
            "BallparkBracketSource": BallparkBracketSource,
            "session": client_session,
        }
        patched = patcher.patched_member(member_for(code))
        exec(marshal.loads(patched[16:]), namespace)
        installed_prime = BallparkBracketSource._prime
        exec(marshal.loads(patched[16:]), namespace)
        self.assertIs(BallparkBracketSource._prime, installed_prime)

        michelle = Michelle()
        source = BallparkBracketSource(michelle)
        source._prime()
        self.assertEqual(source.prime_count, 0)

        michelle.fail = True
        source._prime()
        self.assertEqual(source.prime_count, 0)
        michelle.fail = False

        michelle.ballpark = object()
        source._prime()
        self.assertEqual(source.prime_count, 1)

        michelle.ballpark = None
        client_session.stationid2 = None
        source._prime()
        self.assertEqual(source.prime_count, 2)

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
                    "fittingCompatibility": "patched",
                    "inventoryView": "patched",
                    "collisionVfx": "patched",
                    "creationTransform": "patched",
                    "dungeonPropHologram": "patched",
                    "turretTracking": "patched",
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
                self.assertTrue(checks[0]["allow_fitting_compatibility_source"])
                self.assertNotIn("allow_map_view_source", checks[1])

    def test_map_only_stage_upgrade_rolls_back_after_a_failed_load(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            code = stage / "code.ccp"
            manifest = stage / "manifest.dat"
            marker_path = stage / ".evejs-frontier-stage.json"
            code.write_bytes(b"existing client archive")
            manifest.write_bytes(b"existing manifest")
            marker = {
                "build": 3502403,
                "nativeBlue": "blue.pyd",
                "patchState": "complete",
                "currentHashes": {
                    "code.ccp": windows.sha256_file(code),
                    "manifest.dat": windows.sha256_file(manifest),
                },
            }
            marker_path.write_text("existing stage marker", encoding="utf-8")
            original = {
                path: path.read_bytes() for path in (code, manifest, marker_path)
            }
            fail_refresh = True

            def run(script, archive, build, check):
                self.assertEqual(script, windows.MAP_VIEW_PATCHER)
                self.assertEqual(build, 3502403)
                if check:
                    return "patched" if archive.read_bytes().endswith(b" map patch") else "source"
                archive.write_bytes(archive.read_bytes() + b" map patch")
                return "patched"

            def refresh(*_args):
                if fail_refresh:
                    raise RuntimeError("manifest load failed")
                manifest.write_bytes(b"refreshed manifest")

            with (
                mock.patch.object(windows, "load_stage", return_value=(marker_path, marker)),
                mock.patch.object(
                    windows, "stage_paths",
                    return_value={"code": code, "manifest": manifest},
                ),
                mock.patch.object(windows, "assert_protected_stage_paths"),
                mock.patch.object(windows, "resolve_profile", return_value=(None, {})),
                mock.patch.object(windows, "manifest_hashes_match", return_value=True),
                mock.patch.object(windows, "run_python_patcher", side_effect=run),
                mock.patch.object(windows, "refresh_manifest_atomic", side_effect=refresh),
            ):
                with self.assertRaisesRegex(windows.FrontierWindowsError, "rolled back"):
                    windows.upgrade_map_view_stage(stage)
                self.assertEqual(
                    {path: path.read_bytes() for path in original}, original
                )

                fail_refresh = False
                report = windows.upgrade_map_view_stage(stage)
                self.assertTrue(report["mapViewValid"])
                self.assertTrue(report["upgraded"])
                saved = windows.read_json(marker_path)
                self.assertEqual(saved["mapViewLifecyclePatchState"], "patched")
                self.assertEqual(
                    saved["currentHashes"]["code.ccp"], windows.sha256_file(code)
                )

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
