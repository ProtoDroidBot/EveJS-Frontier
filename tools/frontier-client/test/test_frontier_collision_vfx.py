"""Regression coverage for resting-contact collision VFX in build 3502403."""

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

import collision_vfx_compatibility_adapter as adapter  # noqa: E402
import patch_frontier_collision_vfx as patcher  # noqa: E402
import frontier_windows_client as windows  # noqa: E402


def member_for(code):
    return importlib.util.MAGIC_NUMBER + bytes(12) + marshal.dumps(code)


class Geo2:
    @staticmethod
    def Vec3Length(vector):
        return sum(component * component for component in vector) ** 0.5


class AdapterTests(unittest.TestCase):
    def install(self):
        calls = []

        class CollisionVfxManager:
            def __init__(self, vfx, duration, callback, ball_id):
                self.vfx = vfx
                self.duration = duration
                self._callback = callback
                self.ball_id = ball_id

        class Ship:
            def __init__(self):
                self.activeCollisionImpacts = {}
                self.removed = []

            def OnCollisions(self, collisions):
                calls.append(collisions)
                for collision in collisions:
                    if "collision_position" not in collision:
                        continue
                    ball_id = collision["collider_ball_id"]
                    manager = self.activeCollisionImpacts.get(ball_id)
                    if manager is None:
                        manager = namespace["_CollisionVfxManager"](
                            object(), 0.5, self._remove_collision_vfx, ball_id
                        )
                        self.activeCollisionImpacts[ball_id] = manager
                    else:
                        manager.duration = 0.5
                return "retail"

            def _remove_collision_vfx(self, manager):
                self.removed.append(manager.ball_id)
                self.activeCollisionImpacts.pop(manager.ball_id, None)

        namespace = {
            "Ship": Ship,
            "_CollisionVfxManager": CollisionVfxManager,
        }
        adapter._evejs_install_collision_vfx_compatibility(namespace)
        return Ship, namespace, calls

    def collision(self, ball_id):
        return {
            "collider_ball_id": ball_id,
            "collision_position": (1.0, 2.0, 3.0),
            "linear_impact": (0.0, 0.0, 0.0),
            "angular_impact": (0.0, 0.0, 0.0),
        }

    def test_brief_contact_plays_then_empty_contact_frame_stops_it(self):
        Ship, _namespace, calls = self.install()
        ship = Ship()
        collision = self.collision(10)

        self.assertEqual(ship.OnCollisions([collision]), "retail")
        self.assertEqual(calls, [[collision]])
        self.assertEqual(ship.activeCollisionImpacts[10].duration, 0.25)
        ship.OnCollisions([])
        self.assertEqual(ship.removed, [10])
        self.assertEqual(ship.activeCollisionImpacts, {})

    def test_continuous_contact_refreshes_effect_regardless_of_impact(self):
        Ship, _namespace, calls = self.install()
        ship = Ship()
        contact = self.collision(10)

        ship.OnCollisions([contact])
        manager = ship.activeCollisionImpacts[10]
        manager.duration = 0
        ship.OnCollisions([contact])
        self.assertIs(ship.activeCollisionImpacts[10], manager)
        self.assertEqual(manager.duration, 0.25)
        self.assertEqual(ship.removed, [])
        self.assertEqual(calls, [[contact], [contact]])

    def test_removed_collider_stops_while_another_contact_continues(self):
        Ship, _namespace, _calls = self.install()
        ship = Ship()
        ship.OnCollisions([self.collision(10), self.collision(20)])

        ship.OnCollisions([self.collision(20)])

        self.assertEqual(ship.removed, [10])
        self.assertEqual(set(ship.activeCollisionImpacts), {20})

    def test_unknown_contact_set_fails_open_and_install_is_idempotent(self):
        Ship, namespace, calls = self.install()
        ship = Ship()
        ship.OnCollisions([self.collision(10)])
        wrapped = Ship.OnCollisions
        wrapped_manager = namespace["_CollisionVfxManager"]
        adapter._evejs_install_collision_vfx_compatibility(namespace)
        unknown = None

        with self.assertRaises(TypeError):
            ship.OnCollisions([unknown])
        self.assertIs(Ship.OnCollisions, wrapped)
        self.assertIs(namespace["_CollisionVfxManager"], wrapped_manager)
        self.assertEqual(ship.removed, [])
        self.assertEqual(calls[-1], [unknown])


class WindowsUpgradeTests(unittest.TestCase):
    def test_upgrade_installs_collision_patch_and_records_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            code = stage / "code.ccp"
            manifest = stage / "manifest.dat"
            marker_path = stage / windows.STAGE_MARKER_NAME
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
            original_code = code.read_bytes()
            checks = []

            def check(*_args, **options):
                checks.append(options)
                return {"valid": True}

            def run(script, *_args, **_kwargs):
                self.assertEqual(script, windows.COLLISION_VFX_PATCHER)
                code.write_bytes(code.read_bytes() + b" plus collision VFX")

            def refresh(*_args):
                manifest.write_bytes(b"refreshed manifest")

            states = windows.expected_code_states(3502403, "patched")
            states["collisionVfx"] = "source"
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
                mock.patch.object(windows, "code_patch_states", return_value=states),
                mock.patch.object(windows, "resolve_profile", return_value=(None, {})),
                mock.patch.object(windows, "run_python_patcher", side_effect=run),
                mock.patch.object(
                    windows, "refresh_manifest_atomic", side_effect=refresh
                ),
            ):
                self.assertTrue(
                    windows.upgrade_industry_storage_stage(stage)["valid"]
                )

            saved = windows.read_json(marker_path)
            self.assertEqual(saved["clientPatchBackup"], "retain-existing-backup")
            self.assertEqual(saved["collisionVfxPatchState"], "patched")
            backup = Path(saved["collisionVfxPatchBackup"])
            self.assertEqual((backup / "code.ccp").read_bytes(), original_code)
            self.assertTrue(checks[0]["allow_collision_vfx_source"])
            self.assertNotIn("allow_collision_vfx_source", checks[1])


@unittest.skipUnless(
    sys.version_info[:2] == (3, 12), "Native code patch requires Python 3.12"
)
class BytecodePatchTests(unittest.TestCase):
    def test_fixture_patch_is_exact_idempotent_and_rejects_tampering(self):
        source = member_for(compile("value = 1\n", "fixture.py", "exec"))
        expected = hashlib.sha256(source).hexdigest()
        patched = patcher.patched_member(source)
        self.assertEqual(patcher.inspect_member(source, expected)[0], "source")
        self.assertEqual(patcher.inspect_member(patched, expected)[0], "patched")
        with mock.patch.object(
            patcher,
            "PREVIOUS_WRAPPER_SHA256",
            {hashlib.sha256(patched).hexdigest()},
        ), mock.patch.object(patcher, "ADAPTER", Path("updated-adapter.py")):
            with mock.patch.object(
                Path,
                "read_text",
                return_value="def _evejs_install_collision_vfx_compatibility(namespace): pass\n",
            ):
                self.assertEqual(
                    patcher.inspect_member(patched, expected)[0], "outdated"
                )
        with self.assertRaises(patcher.CollisionVfxPatchError):
            patcher.inspect_member(patched[:-1] + b"!", expected)
        with self.assertRaises(patcher.CollisionVfxPatchError):
            patcher.inspect_archive(Path("unused"), 3502404)

    @unittest.skipUnless(
        os.environ.get("EVE_FRONTIER_TEST_ARCHIVE"),
        "Set EVE_FRONTIER_TEST_ARCHIVE for real bytecode validation",
    )
    def test_supported_archive_patch_is_idempotent_and_preserves_other_members(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "code.ccp"
            with zipfile.ZipFile(os.environ["EVE_FRONTIER_TEST_ARCHIVE"]) as source:
                member = source.read(patcher.MODULE)
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr(patcher.MODULE, member)
                archive.writestr("unrelated.pyc", b"preserve exactly")

            self.assertEqual(patcher.inspect_archive(archive_path), "source")
            patcher.patch_archive(archive_path)
            once = archive_path.read_bytes()
            self.assertEqual(patcher.inspect_archive(archive_path), "patched")
            patcher.patch_archive(archive_path)
            self.assertEqual(archive_path.read_bytes(), once)
            with zipfile.ZipFile(archive_path) as result:
                self.assertEqual(result.read("unrelated.pyc"), b"preserve exactly")


if __name__ == "__main__":
    unittest.main()
