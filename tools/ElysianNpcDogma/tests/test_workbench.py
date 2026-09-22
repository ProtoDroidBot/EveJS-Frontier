from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from elysian_fsd.models import FsdChangeSet, FsdDocument, FsdSchema

from elysian_npc_dogma.catalog import NpcDogmaCatalog, find_source_suggestions
from elysian_npc_dogma.changes import apply_target_edit, build_document, make_copy_edit
from elysian_npc_dogma.models import (
    EffectOperation,
    NpcDogmaProject,
    load_project,
    save_project,
)
from elysian_npc_dogma.server_projection import build_server_projection
from elysian_npc_dogma.validation import validate_project


class NpcDogmaWorkbenchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="npc-dogma-test-")
        self.root = Path(self.temporary.name)
        data = self.root / "_local" / "gameStore" / "data"
        self._write_json(
            data / "npcProfiles" / "data.json",
            {
                "profiles": [
                    {
                        "profileID": "test-npc",
                        "shipTypeID": 100,
                        "npcFittingRestrictions": {"cpuOutput": 50},
                    }
                ]
            },
        )
        self._write_json(
            data / "npcSpawnPools" / "data.json",
            {"pools": [{"profileID": "test-npc"}]},
        )
        types = {
            100: {
                "name": {"en": "Test Raider"},
                "groupID": 500,
                "published": True,
                "graphicID": 10,
                "raceID": 1,
            },
            101: {
                "name": {"en": "Hidden Cache"},
                "groupID": 501,
                "published": False,
            },
            200: {
                "name": {"en": "Test Battleship"},
                "groupID": 600,
                "published": True,
                "graphicID": 10,
                "raceID": 1,
            },
        }
        groups = {
            500: {"name": {"en": "Deadspace Battleship"}, "categoryID": 11},
            501: {"name": {"en": "Cargo Container"}, "categoryID": 11},
            600: {"name": {"en": "Battleship"}, "categoryID": 6},
        }
        type_dogma = {
            100: {
                "dogmaAttributes": [
                    {"attributeID": 14, "value": 2.0},
                    {"attributeID": 5633, "value": 25.0},
                ],
                "dogmaEffects": [{"effectID": 11, "isDefault": 1}],
            },
            200: {
                "dogmaAttributes": [
                    {"attributeID": 14, "value": 8.0},
                    {"attributeID": 48, "value": 650.0},
                    {"attributeID": 5633, "value": 1200.0},
                ],
                "dogmaEffects": [{"effectID": 10, "isDefault": 0}],
            },
        }
        attributes = {
            14: self._attribute("hiSlots", data_type=1),
            48: self._attribute("cpuOutput"),
            5633: self._attribute("fuelCapacity"),
        }
        effects = {
            10: {"effectName": "shipOnline", "effectCategory": 0, "published": True},
            11: {"effectName": "npcLegacy", "effectCategory": 0, "published": True},
        }
        self.catalog = NpcDogmaCatalog(
            None,
            self.root / "exports",
            self.root,
            types,
            groups,
            type_dogma,
            attributes,
            effects,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @staticmethod
    def _attribute(name: str, *, data_type: int = 0) -> dict:
        return {
            "name": name,
            "displayName": {"en": name},
            "description": {"en": f"{name} description"},
            "defaultValue": 0,
            "dataType": data_type,
            "published": True,
        }

    @staticmethod
    def _write_json(path: Path, value: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), "utf-8")

    def _project(self) -> NpcDogmaProject:
        edit = make_copy_edit(
            self.catalog,
            100,
            200,
            ("hiSlots", "cpuOutput", "fuelCapacity"),
            (10,),
        )
        edit.effects.append(
            EffectOperation(
                effect_id=11,
                name="npcLegacy",
                action="remove",
                before_is_default=1,
            )
        )
        return NpcDogmaProject(
            name="test change",
            build=0,
            profile_id="test",
            type_dogma_base_sha256="base",
            edits=[edit],
        )

    def test_inventory_distinguishes_state_and_usage(self) -> None:
        target = self.catalog.by_type_id[100]
        hidden = self.catalog.by_type_id[101]
        self.assertEqual(target.classification, "npc_ship")
        self.assertTrue(target.published)
        self.assertTrue(target.configured)
        self.assertTrue(target.spawnable)
        self.assertEqual(target.shadowed_fields, ("cpuOutput",))
        self.assertFalse(hidden.published)
        self.assertEqual(hidden.classification, "structure_or_container")
        self.assertEqual(find_source_suggestions(target, self.catalog.player_ships)[0].type_id, 200)

    def test_attributes_and_effects_are_applied_without_replacing_the_record(self) -> None:
        project = self._project()
        result = apply_target_edit(self.catalog.type_dogma[100], project.edits[0])
        attributes = {
            item["attributeID"]: item["value"] for item in result["dogmaAttributes"]
        }
        effects = {
            item["effectID"]: item["isDefault"] for item in result["dogmaEffects"]
        }
        self.assertEqual(attributes, {14: 8.0, 48: 650.0, 5633: 1200.0})
        self.assertEqual(effects, {10: 0})
        self.assertTrue(validate_project(self.catalog, project).valid)

    def test_document_and_server_projection_keep_effect_metadata(self) -> None:
        project = self._project()
        document = FsdDocument(
            table_name="typeDogma",
            logical_path="res:/staticdata/typeDogma.fsdbinary",
            source_sha256="base",
            schema=FsdSchema("typeDogma"),
            records=json.loads(json.dumps(self.catalog.type_dogma)),
            change_set=FsdChangeSet("typeDogma", "base"),
        )
        document.records = {int(key): value for key, value in document.records.items()}
        changed = build_document(self.catalog, project, document=document)
        projection = build_server_projection(self.catalog, changed)
        server_record = projection["typesByTypeID"]["100"]
        self.assertEqual(server_record["effects"], [10])
        self.assertEqual(
            server_record["effectEntries"],
            [{"effectID": 10, "isDefault": 0}],
        )
        self.assertGreaterEqual(len(changed.change_set.changes), 2)

    def test_project_round_trip(self) -> None:
        project = self._project()
        path = save_project(project, self.root / "change")
        loaded = load_project(path)
        self.assertEqual(path.suffix, ".elysiannpcdogma")
        self.assertEqual(loaded.to_dict(), project.to_dict())


if __name__ == "__main__":
    unittest.main()
