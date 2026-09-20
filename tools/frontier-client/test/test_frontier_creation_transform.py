"""Regression coverage for Creation module mirror/flip support."""

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

import creation_transform_adapter as adapter  # noqa: E402
import creation_transform_validation_adapter as validation_adapter  # noqa: E402
import creation_preset_view_adapter as preset_view_adapter  # noqa: E402
import patch_frontier_creation_transform as patcher  # noqa: E402


NS = types.SimpleNamespace


class CreationTransformAdapterTests(unittest.TestCase):
    def test_reflection_is_bounded_to_the_authored_shape(self):
        cells = frozenset({(0, 0), (1, 0), (0, 1)})
        self.assertEqual(
            adapter._evejs_reflect_cells(cells, 180, 0),
            frozenset({(1, 0), (0, 0), (1, 1)}),
        )
        self.assertEqual(
            adapter._evejs_reflect_cells(cells, 0, 180),
            frozenset({(0, 1), (1, 1), (0, 0)}),
        )

    def test_manager_move_serializes_reflections_in_rotation_axes(self):
        class HeldModule:
            pass

        class HeldModulePartSource:
            pass

        class SnappedPartCell:
            pass

        class ManagementViewIntegration:
            _start_drag_interior_module = lambda self, source: None
            _handle_global_mouse_wheel = lambda self, event: None
            _compute_binding_hints = lambda self: ()
            _create_module_controller = lambda self, creation, item_id: NS()
            _update_part_controller = lambda self, creation, part_id, controller: None
            _release_held_module = lambda self: None

        class CreationManager:
            def _apply_change(self, change):
                return change

        class MoveChange:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

        namespace = {
            "ManagementViewIntegration": ManagementViewIntegration,
            "CreationManager": CreationManager,
            "HeldModule": HeldModule,
            "HeldModulePartSource": HeldModulePartSource,
            "SnappedPartCell": SnappedPartCell,
            "ModuleController": lambda **kwargs: NS(**kwargs),
            "CellGridData": tuple,
            "BindingHintData": lambda key, label: (key, label),
            "MoveChange": MoveChange,
            "AddChange": MoveChange,
            "get_module_cells": lambda type_id: frozenset({(0, 0)}),
            "rotate_cell_grid": lambda cells, rotation_z: cells,
            "find_cell_grid_center": lambda cells: (0, 0),
            "default_hardpoint_placements": lambda **kwargs: [],
            "get_part_cells": lambda graphic_id: set(),
            "cell_add": lambda left, right: (
                left[0] + right[0], left[1] + right[1]
            ),
            "CreationLayoutValidator": NS(
                reconstruct_final_layout=lambda creation, changes: creation
            ),
        }
        adapter._evejs_install_creation_transforms(namespace)
        manager = CreationManager()
        manager._evejs_rotation_x = 180
        manager._evejs_rotation_y = 0
        change = manager.move(7, 2, (4, 5), 90)
        self.assertEqual(change.module_item_id, 7)
        self.assertEqual(change.rotation_x, 180)
        self.assertEqual(change.rotation_y, 0)
        self.assertEqual(change.rotation_z, 90)

    def test_local_validator_reflects_before_rotating(self):
        class Validator:
            @staticmethod
            def _rotate_offset(dx, dy, dz, rotation_z):
                if rotation_z == 90:
                    return -dy, dx, dz
                return dx, dy, dz

        namespace = {"CreationLayoutValidator": Validator}
        validation_adapter._evejs_install_creation_transform_validation(namespace)
        placement = NS(
            x=10,
            y=20,
            z=0,
            rotation=NS(x=180, y=0, z=90),
        )
        self.assertEqual(
            Validator._absolute_cells(
                placement, [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
            ),
            [(10, 21, 0), (10, 20, 0), (9, 21, 0)],
        )


class CreationPresetPresenterTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        test = self

        class Service:
            def list_creation_presets(self):
                test.calls.append(("list",))
                return [{
                    "presetID": "p1",
                    "name": "Baseline",
                    "description": "Validated layout",
                    "creationTypeID": 95735,
                    "summary": {
                        "moduleCount": 5,
                        "interiorModuleCount": 3,
                        "exteriorModuleCount": 2,
                        "cellCount": 18,
                        "sdeCompatible": True,
                    },
                }]

            def save_creation_preset(self, creation_id, name, description):
                test.calls.append(("save", creation_id, name, description))
                return {"success": True, "data": {"presetID": "p1"}}

            def rename_creation_preset(self, preset_id, name, description):
                test.calls.append(("rename", preset_id, name, description))
                return {"success": True, "data": {"presetID": preset_id}}

            def delete_creation_preset(self, preset_id):
                test.calls.append(("delete", preset_id))
                return {"success": True, "data": {"presetID": preset_id}}

            def preview_creation_preset(self, creation_id, preset_id):
                test.calls.append(("preview", creation_id, preset_id))
                return {
                    "success": True,
                    "diagnostics": [],
                    "data": {
                        "previewToken": "bound-token",
                        "additions": [{"typeID": 1, "quantity": 2}],
                        "removals": [{"typeID": 2, "quantity": 1}],
                        "missing": [],
                        "capacities": {
                            "cargo": {
                                "usedBefore": 10,
                                "usedAfter": 12,
                                "after": 30,
                            }
                        },
                    },
                }

            def apply_creation_preset(
                self, creation_id, preset_id, preview_token
            ):
                test.calls.append(
                    ("apply", creation_id, preset_id, preview_token)
                )
                return {"success": True, "data": {}}

        self.presenter = preset_view_adapter._EvejsCreationPresetPresenter(
            Service(), 9001, 95735
        )

    def test_preview_is_required_and_token_is_forwarded_once(self):
        self.presenter.refresh()
        self.presenter.select("p1")
        self.assertFalse(self.presenter.can_apply)
        self.assertIsNone(self.presenter.apply_selected())
        self.presenter.preview_selected()
        self.assertTrue(self.presenter.can_apply)
        self.assertIn("+2 / -1", self.presenter.preview_details())
        result = self.presenter.apply_selected()
        self.assertTrue(result["success"])
        self.assertFalse(self.presenter.can_apply)
        self.assertIn(("apply", 9001, "p1", "bound-token"), self.calls)

    def test_mutations_invalidate_preview_and_summary_exposes_compatibility(self):
        self.presenter.refresh()
        self.presenter.select("p1")
        self.presenter.preview_selected()
        self.presenter.rename("Renamed", "new")
        self.assertFalse(self.presenter.can_apply)
        details = self.presenter.selected_details()
        self.assertIn("Hull type: 95735 (compatible)", details)
        self.assertIn("SDE: compatible", details)
        self.assertIn("5 (3 interior, 2 exterior)", details)
        self.assertIn("Occupied cells: 18", details)


@unittest.skipUnless(
    sys.version_info[:2] == (3, 12), "Native code patch requires Python 3.12"
)
class CreationTransformPatchTests(unittest.TestCase):
    @unittest.skipUnless(
        os.environ.get("EVE_FRONTIER_TEST_ARCHIVE"),
        "EVE_FRONTIER_TEST_ARCHIVE was not supplied",
    )
    def test_archive_patch_is_exact_and_idempotent(self):
        source_path = Path(os.environ["EVE_FRONTIER_TEST_ARCHIVE"])
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / "code.ccp"
            with zipfile.ZipFile(source_path) as source:
                members = {
                    name: source.read(name) for name in patcher.MODULES
                }
            with zipfile.ZipFile(archive_path, "w") as archive:
                for name, member in members.items():
                    archive.writestr(name, member)
                archive.writestr("unrelated.pyc", b"preserve exactly")

            self.assertIn(
                patcher.inspect_archive(archive_path)[0],
                {"source", "outdated", "patched"},
            )
            patcher.patch_archive(archive_path)
            self.assertEqual(patcher.inspect_archive(archive_path)[0], "patched")
            patcher.patch_archive(archive_path)
            with zipfile.ZipFile(archive_path) as result:
                self.assertEqual(result.read("unrelated.pyc"), b"preserve exactly")

    def test_unknown_build_fails_closed(self):
        with self.assertRaises(patcher.CreationTransformPatchError):
            patcher.inspect_archive(Path("unused"), 3502404)


if __name__ == "__main__":
    unittest.main()
