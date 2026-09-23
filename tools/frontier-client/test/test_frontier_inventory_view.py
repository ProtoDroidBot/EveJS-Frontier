"""Regression coverage for the full-screen inventory in Frontier build 3502403."""

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

import inventory_view_compatibility_adapter as adapter  # noqa: E402
import patch_frontier_inventory as patcher  # noqa: E402
import frontier_windows_client as windows  # noqa: E402


NS = types.SimpleNamespace


def member_for(code):
    return importlib.util.MAGIC_NUMBER + bytes(12) + marshal.dumps(code)


class AdapterTests(unittest.TestCase):
    def test_active_inventory_command_closes_without_reopening(self):
        events = []

        class ViewState:
            def IsViewActive(self, name):
                events.append(("active", name))
                return True

            def CloseSecondaryView(self, name):
                events.append(("close", name))
                return "closed"

        def original(inv_id=None):
            events.append(("open", inv_id))

        namespace = {
            "open_inventory": original,
            "ServiceManager": NS(
                Instance=lambda: NS(GetService=lambda name: ViewState())
            ),
            "INVENTORY_VIEW_STATE_ID": "inventory",
            "session": NS(charid=7),
        }
        adapter._evejs_install_inventory_view_compatibility(namespace, "open")

        self.assertEqual(namespace["open_inventory"](("ShipCargo", 99)), "closed")
        self.assertEqual(events, [("active", "inventory"), ("close", "inventory")])

    def test_inactive_inventory_preserves_native_open_path(self):
        events = []

        class ViewState:
            def IsViewActive(self, name):
                events.append(("active", name))
                return False

        def original(inv_id=None):
            events.append(("open", inv_id))
            return "opened"

        namespace = {
            "open_inventory": original,
            "ServiceManager": NS(
                Instance=lambda: NS(GetService=lambda name: ViewState())
            ),
            "INVENTORY_VIEW_STATE_ID": "inventory",
            "session": NS(charid=7),
        }
        adapter._evejs_install_inventory_view_compatibility(namespace, "open")

        self.assertEqual(namespace["open_inventory"](("DroneBay", 99)), "opened")
        self.assertEqual(
            events,
            [("active", "inventory"), ("open", ("DroneBay", 99))],
        )

    def test_docked_inventory_does_not_request_space_overlays(self):
        observed = []

        class InventoryViewState:
            __overlays__ = {"hud", "brackets", "target", "sidePanels", "notice"}

            def LoadView(self, **kwargs):
                observed.append((set(self.__overlays__), kwargs))
                return "loaded"

        namespace = {
            "InventoryViewState": InventoryViewState,
            "HUD_OVERLAY_ID": "hud",
            "HUD_BRACKET_LAYER_ID": "brackets",
            "ViewOverlay": NS(Target="target"),
            "session": NS(charid=7, stationid=60003760, structureid=None),
        }
        adapter._evejs_install_inventory_view_compatibility(
            namespace, "view_state"
        )
        state = InventoryViewState()

        self.assertEqual(state.LoadView(secondary_inv_id=None), "loaded")
        self.assertEqual(
            observed[-1],
            ({"sidePanels", "notice"}, {"secondary_inv_id": None}),
        )

        namespace["session"].stationid = None
        self.assertEqual(state.LoadView(secondary_inv_id=None), "loaded")
        self.assertEqual(
            observed[-1][0],
            {"hud", "brackets", "target", "sidePanels", "notice"},
        )

    def test_docked_structure_uses_the_same_overlay_guard(self):
        observed = []

        class InventoryViewState:
            __overlays__ = {"hud", "brackets", "target", "sidePanels"}

            def LoadView(self, **kwargs):
                observed.append(set(self.__overlays__))

        namespace = {
            "InventoryViewState": InventoryViewState,
            "HUD_OVERLAY_ID": "hud",
            "HUD_BRACKET_LAYER_ID": "brackets",
            "ViewOverlay": NS(Target="target"),
            "session": NS(charid=7, stationid=None, structureid=1024),
        }
        adapter._evejs_install_inventory_view_compatibility(
            namespace, "view_state"
        )
        InventoryViewState().LoadView()
        self.assertEqual(observed, [{"sidePanels"}])

    def test_both_adapter_installers_are_idempotent(self):
        class InventoryViewState:
            __overlays__ = {"hud", "brackets", "target"}

            def LoadView(self, **kwargs):
                pass

        def original(inv_id=None):
            pass

        common = {
            "ServiceManager": NS(Instance=lambda: None),
            "INVENTORY_VIEW_STATE_ID": "inventory",
            "session": NS(charid=7),
        }
        open_namespace = dict(common, open_inventory=original)
        state_namespace = dict(
            common,
            InventoryViewState=InventoryViewState,
            HUD_OVERLAY_ID="hud",
            HUD_BRACKET_LAYER_ID="brackets",
            ViewOverlay=NS(Target="target"),
        )
        adapter._evejs_install_inventory_view_compatibility(
            open_namespace, "open"
        )
        adapter._evejs_install_inventory_view_compatibility(
            state_namespace, "view_state"
        )
        wrapped_open = open_namespace["open_inventory"]
        wrapped_load = InventoryViewState.LoadView

        adapter._evejs_install_inventory_view_compatibility(
            open_namespace, "open"
        )
        adapter._evejs_install_inventory_view_compatibility(
            state_namespace, "view_state"
        )
        self.assertIs(open_namespace["open_inventory"], wrapped_open)
        self.assertIs(InventoryViewState.LoadView, wrapped_load)


class WindowsUpgradeTests(unittest.TestCase):
    def test_upgrade_installs_inventory_patch_and_records_backup(self):
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
                self.assertEqual(script, windows.INVENTORY_VIEW_PATCHER)
                code.write_bytes(code.read_bytes() + b" plus inventory view")

            def refresh(*_args):
                manifest.write_bytes(b"refreshed manifest")

            states = windows.expected_code_states(3502403, "patched")
            states["inventoryView"] = "source"
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
                self.assertTrue(
                    windows.upgrade_industry_storage_stage(stage)["valid"]
                )

            saved = windows.read_json(marker_path)
            self.assertEqual(saved["clientPatchBackup"], "retain-existing-backup")
            self.assertEqual(saved["inventoryViewPatchState"], "patched")
            backup = Path(saved["inventoryViewPatchBackup"])
            self.assertEqual((backup / "code.ccp").read_bytes(), original_code)
            self.assertTrue(checks[0]["allow_inventory_view_source"])
            self.assertNotIn("allow_inventory_view_source", checks[1])


@unittest.skipUnless(
    sys.version_info[:2] == (3, 12), "Native code patch requires Python 3.12"
)
class BytecodePatchTests(unittest.TestCase):
    def test_exact_previous_generation_upgrades_and_rejects_tampering(self):
        profiles = {}
        previous = {}
        members = {}
        for index, kind in enumerate(("open", "view_state")):
            source = member_for(compile(f"value = {index}\n", "fixture.py", "exec"))
            name = f"fixture/{kind}.pyc"
            profiles[name] = (kind, hashlib.sha256(source).hexdigest())
            wrapper = marshal.loads(patcher.patched_member(source, kind)[16:])
            old_adapter = marshal.dumps(compile("pass\n", "evejs/inventory_view_compatibility_adapter.py", "exec"))
            old_constants = tuple(
                old_adapter if isinstance(value, bytes) and value != source else value
                for value in wrapper.co_consts
            )
            members[name] = source[:16] + marshal.dumps(wrapper.replace(co_consts=old_constants))
            previous[kind] = hashlib.sha256(members[name]).hexdigest()

        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(patcher.PROFILES, profiles, clear=True), \
             mock.patch.dict(patcher.PREVIOUS_WRAPPER_SHA256, previous, clear=True):
            archive = Path(directory) / "code.ccp"
            with zipfile.ZipFile(archive, "w") as target:
                for name, member in members.items():
                    target.writestr(name, member)
                target.writestr("unrelated.pyc", b"preserve")
            self.assertEqual(patcher.inspect_archive(archive)[0], "outdated")
            changed = bytearray(next(iter(members.values())))
            changed[-1] ^= 1
            with self.assertRaises(patcher.InventoryViewPatchError):
                patcher.inspect_member(bytes(changed), "open", profiles["fixture/open.pyc"][1])
            patcher.patch_archive(archive)
            self.assertEqual(patcher.inspect_archive(archive)[0], "patched")
            once = archive.read_bytes()
            patcher.patch_archive(archive)
            self.assertEqual(archive.read_bytes(), once)
            with zipfile.ZipFile(archive) as result:
                self.assertEqual(result.read("unrelated.pyc"), b"preserve")

    def test_fixture_patch_is_exact_idempotent_and_rejects_tampering(self):
        source = member_for(compile("value = 1\n", "fixture.py", "exec"))
        expected = hashlib.sha256(source).hexdigest()
        patched = patcher.patched_member(source, "open")
        self.assertEqual(
            patcher.inspect_member(source, "open", expected)[0], "source"
        )
        self.assertEqual(
            patcher.inspect_member(patched, "open", expected)[0], "patched"
        )
        with self.assertRaises(patcher.InventoryViewPatchError):
            patcher.inspect_member(patched[:-1] + b"!", "open", expected)
        with self.assertRaises(patcher.InventoryViewPatchError):
            patcher.inspect_archive(Path("unused"), 3502404)

    @unittest.skipUnless(
        os.environ.get("EVE_FRONTIER_TEST_ARCHIVE"),
        "Set EVE_FRONTIER_TEST_ARCHIVE for real bytecode validation",
    )
    def test_supported_archive_patch_is_idempotent_and_preserves_other_members(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "code.ccp"
            with zipfile.ZipFile(os.environ["EVE_FRONTIER_TEST_ARCHIVE"]) as source:
                members = {
                    name: source.read(name) for name in patcher.PROFILES
                }
            with zipfile.ZipFile(archive_path, "w") as archive:
                for name, member in members.items():
                    archive.writestr(name, member)
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
