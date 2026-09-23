"""Fitted weapon models follow the selected completed target lock."""

from pathlib import Path
import hashlib
import importlib.util
import marshal
import sys
import tempfile
import types
import unittest
from unittest import mock
import zipfile


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import turret_target_tracking_adapter as adapter  # noqa: E402
import patch_frontier_turret_tracking as patcher  # noqa: E402


class WeaponModel:
    def __init__(self, skill_shot=False):
        self.is_skill_shot_turret = skill_shot
        self.targetID = None
        self.available = False
        self.shooting = False
        self.aimed = []
        self.stops = 0

    def SetTargetsAvailable(self, available):
        self.available = available

    def SetTarget(self, target_id):
        self.targetID = target_id

    def TakeAim(self, target_id):
        self.aimed.append(target_id)

    def IsShooting(self):
        return self.shooting

    def StopShooting(self):
        self.shooting = False
        self.stops += 1


class TurretTrackingTests(unittest.TestCase):
    def setUp(self):
        adapter.eve = types.SimpleNamespace(
            session=types.SimpleNamespace(shipid=10)
        )
        self.turret = WeaponModel()
        self.launcher = WeaponModel()
        self.skill_shot = WeaponModel(skill_shot=True)
        self.ship = types.SimpleNamespace(
            turrets=[self.turret, self.launcher, self.skill_shot]
        )
        self.targets = {101: object(), 102: object()}
        self.active_target = None
        fixture = self

        class TurretSvc:
            def __init__(self):
                self.michelle = types.SimpleNamespace(
                    GetBall=lambda item_id: fixture.ship if item_id == 10 else None
                )
                self.target = types.SimpleNamespace(
                    GetTargets=lambda: fixture.targets,
                    GetActiveTargetID=lambda: fixture.active_target,
                )

            def Startup(self):
                pass

            def ProcessTargetChanged(self, *args):
                pass

            def OnStateChange(self, *args):
                pass

            def OnGodmaItemChange(self, *args):
                pass

            def ProcessActiveShipChanged(self, *args):
                pass

        adapter._evejs_install_turret_target_tracking({
            "TurretSvc": TurretSvc,
            "state": types.SimpleNamespace(activeTarget="activeTarget"),
        })
        self.service = TurretSvc()

    def test_lock_selection_and_loss_aim_fitted_turret_and_launcher(self):
        self.service.ProcessTargetChanged("add", 101, None)
        for weapon in (self.turret, self.launcher):
            self.assertTrue(weapon.available)
            self.assertEqual(weapon.aimed, [101])
        self.assertEqual(self.skill_shot.aimed, [])
        self.service.OnStateChange(101, "selected")
        self.service.ProcessTargetChanged("add", 101, None)
        self.assertEqual(self.turret.aimed, [101])

        self.active_target = 102
        self.service.OnStateChange(102, "activeTarget")
        for weapon in (self.turret, self.launcher):
            self.assertEqual(weapon.targetID, 102)

        self.targets.pop(102)
        self.service.ProcessTargetChanged("lost", 102, None)
        for weapon in (self.turret, self.launcher):
            self.assertEqual(weapon.targetID, 101)

        self.targets.clear()
        self.service.ProcessTargetChanged("clear", None, None)
        for weapon in (self.turret, self.launcher):
            self.assertFalse(weapon.available)
            self.assertIsNone(weapon.targetID)

    def test_firing_keeps_cycle_target_then_resumes_current_lock(self):
        self.service.Startup()
        self.turret.shooting = True
        self.active_target = 102
        self.service.OnStateChange(102, "activeTarget")
        self.assertEqual(self.turret.targetID, 101)
        self.turret.StopShooting()
        self.assertEqual(self.turret.stops, 1)
        self.assertEqual(self.turret.targetID, 102)
        self.assertEqual(self.turret.aimed[-1], 102)

    def test_refitted_weapon_tracks_existing_lock(self):
        self.ship.turrets = [self.turret]
        self.service.Startup()
        replacement = WeaponModel()
        self.ship.turrets.append(replacement)
        self.service.OnGodmaItemChange(None, None)
        self.assertEqual(replacement.aimed, [101])


class TurretTrackingPatchTests(unittest.TestCase):
    def test_exact_previous_wrapper_is_upgradeable(self):
        original = (
            importlib.util.MAGIC_NUMBER + bytes(12) +
            marshal.dumps(compile("class TurretSvc: pass\n", "fixture.py", "exec"))
        )
        wrapper = marshal.loads(patcher.patched_member(original)[16:])
        old_adapter = marshal.dumps(compile("pass\n", "evejs/turret_target_tracking_adapter.py", "exec"))
        constants = tuple(
            old_adapter if isinstance(value, bytes) and value != original else value
            for value in wrapper.co_consts
        )
        previous = original[:16] + marshal.dumps(wrapper.replace(co_consts=constants))
        with mock.patch.object(patcher, "SOURCE_MEMBER_SHA256", hashlib.sha256(original).hexdigest()), \
             mock.patch.object(patcher, "PREVIOUS_WRAPPER_SHA256", {hashlib.sha256(previous).hexdigest()}), \
             tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "code.ccp"
            with zipfile.ZipFile(archive, "w") as target:
                target.writestr(patcher.MODULE_NAME, previous)
            self.assertEqual(patcher.inspect_archive(archive)[0], "outdated")
            patcher.patch_archive(archive)
            self.assertEqual(patcher.inspect_archive(archive)[0], "patched")
            once = archive.read_bytes()
            patcher.patch_archive(archive)
            self.assertEqual(archive.read_bytes(), once)

    def test_exact_archive_patch_preserves_other_members_and_is_idempotent(self):
        original = (
            importlib.util.MAGIC_NUMBER + bytes(12) +
            marshal.dumps(compile("class TurretSvc: pass\n", "fixture.py", "exec"))
        )
        digest = hashlib.sha256(original).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "code.ccp"
            with zipfile.ZipFile(archive, "w") as target:
                target.writestr(patcher.MODULE_NAME, original)
                target.writestr("unrelated.pyc", b"preserve")
            retail_digest = patcher.SOURCE_MEMBER_SHA256
            patcher.SOURCE_MEMBER_SHA256 = digest
            try:
                self.assertEqual(patcher.inspect_archive(archive)[0], "source")
                patcher.patch_archive(archive)
                self.assertEqual(patcher.inspect_archive(archive)[0], "patched")
                once = archive.read_bytes()
                patcher.patch_archive(archive)
                self.assertEqual(archive.read_bytes(), once)
                with zipfile.ZipFile(archive) as result:
                    self.assertEqual(result.read("unrelated.pyc"), b"preserve")
                    self.assertNotEqual(result.read(patcher.MODULE_NAME), original)
            finally:
                patcher.SOURCE_MEMBER_SHA256 = retail_digest


if __name__ == "__main__":
    unittest.main()
