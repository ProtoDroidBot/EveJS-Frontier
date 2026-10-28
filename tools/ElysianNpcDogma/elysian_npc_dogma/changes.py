from __future__ import annotations

import copy
import math
from typing import Any, Iterable

from elysian_fsd.documents import DocumentLoader
from elysian_fsd.models import FsdDocument

from .catalog import NpcDogmaCatalog
from .models import (
    AttributeOperation,
    EffectOperation,
    NpcDogmaProject,
    TargetEdit,
)


def _attribute_entries(values: dict[int, float]) -> list[dict[str, Any]]:
    return [
        {"attributeID": attribute_id, "value": value}
        for attribute_id, value in sorted(values.items())
    ]


def _effect_entries(values: dict[int, int], order: Iterable[int]) -> list[dict[str, Any]]:
    ordered: list[int] = []
    for effect_id in order:
        if effect_id in values and effect_id not in ordered:
            ordered.append(effect_id)
    ordered.extend(sorted(set(values) - set(ordered)))
    return [
        {"effectID": effect_id, "isDefault": int(values[effect_id])}
        for effect_id in ordered
    ]


def apply_target_edit(
    record: dict[str, Any] | None,
    edit: TargetEdit,
) -> dict[str, Any]:
    result = copy.deepcopy(record) if isinstance(record, dict) else {
        "dogmaAttributes": [],
        "dogmaEffects": [],
    }
    attributes: dict[int, float] = {}
    for entry in result.get("dogmaAttributes", []):
        if isinstance(entry, dict):
            attributes[int(entry.get("attributeID") or 0)] = float(entry.get("value") or 0)
    for operation in edit.attributes:
        if operation.action == "remove":
            attributes.pop(operation.attribute_id, None)
        elif operation.action == "set":
            if operation.value is None or not math.isfinite(float(operation.value)):
                raise ValueError(
                    f"Attribute {operation.name or operation.attribute_id} has no finite value"
                )
            attributes[operation.attribute_id] = float(operation.value)
        else:
            raise ValueError(f"Unsupported attribute action: {operation.action}")

    effects: dict[int, int] = {}
    effect_order: list[int] = []
    for entry in result.get("dogmaEffects", []):
        if not isinstance(entry, dict):
            continue
        effect_id = int(entry.get("effectID") or 0)
        effects[effect_id] = int(entry.get("isDefault") or 0)
        effect_order.append(effect_id)
    for operation in edit.effects:
        if operation.action == "remove":
            effects.pop(operation.effect_id, None)
        elif operation.action in {"add", "set_default"}:
            effects[operation.effect_id] = int(operation.is_default or 0)
        else:
            raise ValueError(f"Unsupported effect action: {operation.action}")

    result["dogmaAttributes"] = _attribute_entries(attributes)
    result["dogmaEffects"] = _effect_entries(effects, effect_order)
    return result


def build_document(
    catalog: NpcDogmaCatalog,
    project: NpcDogmaProject,
    *,
    document: FsdDocument | None = None,
) -> FsdDocument:
    if catalog.profile is None and document is None:
        raise ValueError("A discovered build profile is required to compile")
    document = document or DocumentLoader(  # type: ignore[arg-type]
        catalog.profile,
        catalog.export_root,
    ).load("typeDogma")
    if project.type_dogma_base_sha256 != document.source_sha256:
        raise ValueError("Project typeDogma baseline does not match the selected client")
    for edit in project.edits:
        before = document.records.get(edit.target_type_id) if isinstance(document.records, dict) else None
        after = apply_target_edit(before, edit)
        if before is None:
            document.insert_record(
                edit.target_type_id,
                {"dogmaAttributes": [], "dogmaEffects": []},
            )
            document.update_value(edit.target_type_id, (), after)
        elif before != after:
            if before.get("dogmaAttributes", []) != after.get("dogmaAttributes", []):
                document.update_value(
                    edit.target_type_id,
                    ("dogmaAttributes",),
                    after["dogmaAttributes"],
                )
            if before.get("dogmaEffects", []) != after.get("dogmaEffects", []):
                document.update_value(
                    edit.target_type_id,
                    ("dogmaEffects",),
                    after["dogmaEffects"],
                )
    return document


def make_copy_edit(
    catalog: NpcDogmaCatalog,
    target_type_id: int,
    source_type_id: int,
    attribute_names: Iterable[str],
    effect_ids: Iterable[int] = (),
) -> TargetEdit:
    target = catalog.by_type_id[int(target_type_id)]
    source = catalog.by_type_id[int(source_type_id)]
    target_attributes = catalog.attribute_values(target.type_id)
    source_attributes = catalog.attribute_values(source.type_id)
    operations: list[AttributeOperation] = []
    for name in attribute_names:
        definition = catalog.attributes_by_name.get(str(name).casefold())
        if definition is None or definition.attribute_id not in source_attributes:
            continue
        operations.append(
            AttributeOperation(
                attribute_id=definition.attribute_id,
                name=definition.name,
                action="set",
                before_value=target_attributes.get(definition.attribute_id),
                value=source_attributes[definition.attribute_id],
                source_type_id=source.type_id,
            )
        )
    target_effects = catalog.effect_values(target.type_id)
    source_effects = catalog.effect_values(source.type_id)
    effect_operations: list[EffectOperation] = []
    for effect_id in sorted(set(int(value) for value in effect_ids)):
        if effect_id not in source_effects:
            continue
        definition = catalog.effects.get(effect_id)
        action = "set_default" if effect_id in target_effects else "add"
        effect_operations.append(
            EffectOperation(
                effect_id=effect_id,
                name=definition.name if definition else f"effect_{effect_id}",
                action=action,
                before_is_default=target_effects.get(effect_id),
                is_default=source_effects[effect_id],
                source_type_id=source.type_id,
            )
        )
    return TargetEdit(
        target_type_id=target.type_id,
        target_name=target.name,
        source_type_id=source.type_id,
        published=target.published,
        classification=target.classification,
        attributes=operations,
        effects=effect_operations,
    )


def semantic_diff(catalog: NpcDogmaCatalog, project: NpcDogmaProject) -> str:
    lines = [
        f"NPC Dogma project: {project.name}",
        f"Build: {project.build}",
        f"Targets: {len(project.edits)}",
        "",
    ]
    for edit in project.edits:
        status = "published" if edit.published else "hidden"
        lines.append(
            f"{edit.target_name} ({edit.target_type_id}) [{status}; {edit.classification}]"
        )
        if edit.source_type_id:
            source = catalog.by_type_id.get(edit.source_type_id)
            lines.append(
                f"  source: {(source.name if source else 'unresolved')} ({edit.source_type_id})"
            )
        for operation in edit.attributes:
            if operation.action == "remove":
                lines.append(
                    f"  attribute - {operation.name} ({operation.attribute_id}): "
                    f"{operation.before_value!r} -> <default>"
                )
            else:
                lines.append(
                    f"  attribute ~ {operation.name} ({operation.attribute_id}): "
                    f"{operation.before_value!r} -> {operation.value!r}"
                )
        for operation in edit.effects:
            if operation.action == "remove":
                lines.append(
                    f"  effect - {operation.name} ({operation.effect_id}), "
                    f"isDefault={operation.before_is_default}"
                )
            else:
                lines.append(
                    f"  effect {'+' if operation.before_is_default is None else '~'} "
                    f"{operation.name} ({operation.effect_id}): "
                    f"isDefault {operation.before_is_default!r} -> {operation.is_default!r}"
                )
        if not edit.attributes and not edit.effects:
            lines.append("  no changes")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
