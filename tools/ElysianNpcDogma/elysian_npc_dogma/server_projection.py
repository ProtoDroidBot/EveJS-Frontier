from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

from elysian_fsd.models import FsdDocument

from .catalog import NpcDogmaCatalog


def _optional_int(row: dict[str, Any], name: str) -> int | None:
    return int(row[name]) if row.get(name) is not None else None


def _attribute_record(
    attribute_id: int,
    row: dict[str, Any],
    catalog: NpcDogmaCatalog,
) -> dict[str, Any]:
    return {
        "attributeID": attribute_id,
        "attributeName": catalog.resolve_name(
            row,
            "displayName",
            "displayNameID",
            str(row.get("name") or ""),
        ),
        "description": catalog.resolve_name(row, "description", "descriptionID"),
        "iconID": _optional_int(row, "iconID"),
        "defaultValue": float(row.get("defaultValue") or 0),
        "published": bool(row.get("published")),
        "displayName": catalog.resolve_name(row, "displayName", "displayNameID"),
        "unitID": _optional_int(row, "unitID"),
        "stackable": bool(row.get("stackable")),
        "highIsGood": bool(row.get("highIsGood")),
        "categoryID": int(row.get("attributeCategoryID") or row.get("categoryID") or 0),
        "name": str(row.get("name") or ""),
        "dataType": int(row.get("dataType") or 0),
        "displayWhenZero": bool(row.get("displayWhenZero")),
    }


def _modifier_record(row: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name in ("domain", "func"):
        if row.get(name) is not None:
            result[name] = str(row[name])
    for name in (
        "modifiedAttributeID",
        "operation",
        "modifyingAttributeID",
        "groupID",
        "skillTypeID",
        "effectID",
    ):
        if row.get(name) is not None:
            result[name] = int(row[name])
    return result


def _effect_record(
    effect_id: int,
    row: dict[str, Any],
    catalog: NpcDogmaCatalog,
) -> dict[str, Any]:
    result = {
        "effectID": effect_id,
        "name": str(row.get("effectName") or row.get("name") or ""),
        "displayName": catalog.resolve_name(row, "displayName", "displayNameID"),
        "description": catalog.resolve_name(row, "description", "descriptionID"),
        "guid": str(row.get("guid") or ""),
        "effectCategoryID": int(row.get("effectCategory") or row.get("effectCategoryID") or 0),
        "iconID": _optional_int(row, "iconID"),
        "dischargeAttributeID": _optional_int(row, "dischargeAttributeID"),
        "durationAttributeID": _optional_int(row, "durationAttributeID"),
        "distribution": _optional_int(row, "distribution"),
        "rangeAttributeID": _optional_int(row, "rangeAttributeID"),
        "falloffAttributeID": _optional_int(row, "falloffAttributeID"),
        "trackingSpeedAttributeID": _optional_int(row, "trackingSpeedAttributeID"),
        "resistanceAttributeID": _optional_int(row, "resistanceAttributeID"),
        "fittingUsageChanceAttributeID": _optional_int(row, "fittingUsageChanceAttributeID"),
        "npcUsageChanceAttributeID": _optional_int(row, "npcUsageChanceAttributeID"),
        "npcActivationChanceAttributeID": _optional_int(row, "npcActivationChanceAttributeID"),
        "published": bool(row.get("published")),
        "isOffensive": bool(row.get("isOffensive")),
        "isAssistance": bool(row.get("isAssistance")),
        "isWarpSafe": bool(row.get("isWarpSafe")),
        "disallowAutoRepeat": bool(row.get("disallowAutoRepeat")),
        "electronicChance": bool(row.get("electronicChance")),
        "propulsionChance": bool(row.get("propulsionChance")),
        "rangeChance": bool(row.get("rangeChance")),
        "modifierInfo": [
            _modifier_record(item)
            for item in row.get("modifierInfo", [])
            if isinstance(item, dict)
        ],
    }
    return result


def _type_record(
    type_id: int,
    row: dict[str, Any],
    catalog: NpcDogmaCatalog,
) -> dict[str, Any]:
    attributes = {
        str(int(item.get("attributeID") or 0)): float(item.get("value") or 0)
        for item in row.get("dogmaAttributes", [])
        if isinstance(item, dict) and int(item.get("attributeID") or 0) > 0
    }
    effect_entries = [
        {
            "effectID": int(item.get("effectID") or 0),
            "isDefault": int(item.get("isDefault") or 0),
        }
        for item in row.get("dogmaEffects", [])
        if isinstance(item, dict) and int(item.get("effectID") or 0) > 0
    ]
    type_row = catalog.types.get(type_id, {})
    return {
        "typeID": type_id,
        "typeName": catalog.resolve_name(
            type_row,
            "name",
            "typeNameID",
            f"Type {type_id}",
        ),
        "attributeCount": len(attributes),
        "effectCount": len(effect_entries),
        "attributes": attributes,
        "effects": [item["effectID"] for item in effect_entries],
        "effectEntries": effect_entries,
    }


def build_server_projection(
    catalog: NpcDogmaCatalog,
    document: FsdDocument,
    *,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(document.records, dict):
        raise TypeError("typeDogma must have a keyed root")
    attribute_types = {
        str(attribute_id): _attribute_record(attribute_id, row, catalog)
        for attribute_id, row in sorted(catalog.attribute_rows.items())
    }
    effect_types = {
        str(effect_id): _effect_record(effect_id, row, catalog)
        for effect_id, row in sorted(catalog.effect_rows.items())
    }
    types = {
        str(int(type_id)): _type_record(int(type_id), row, catalog)
        for type_id, row in sorted(document.records.items(), key=lambda item: int(item[0]))
        if isinstance(row, dict)
    }
    total_attributes = sum(item["attributeCount"] for item in types.values())
    total_effects = sum(item["effectCount"] for item in types.values())
    previous_source = copy.deepcopy((existing or {}).get("source", {}))
    source = {
        **previous_source,
        "provider": "EVE client typeDogma verified by Elysian NPC Dogma Workbench",
        "buildNumber": catalog.build,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "generatedBy": "tools/ElysianNpcDogma",
    }
    return {
        "source": source,
        "attributeTypesByID": attribute_types,
        "effectTypesByID": effect_types,
        "typesByTypeID": types,
        "counts": {
            "types": len(types),
            "attributeTypes": len(attribute_types),
            "effectTypes": len(effect_types),
            "totalAttributes": total_attributes,
            "totalEffects": total_effects,
        },
    }
