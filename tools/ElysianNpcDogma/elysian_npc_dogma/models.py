from __future__ import annotations

import json
import os
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from elysian_fsd.models import utc_now


PROJECT_FORMAT = "elysian-npc-dogma-project"
PROJECT_VERSION = 1
AttributeAction = Literal["set", "remove"]
EffectAction = Literal["add", "remove", "set_default"]


@dataclass(frozen=True, slots=True)
class AttributeDefinition:
    attribute_id: int
    name: str
    display_name: str
    description: str
    unit_id: int | None
    data_type: int
    default_value: float
    published: bool


@dataclass(frozen=True, slots=True)
class EffectDefinition:
    effect_id: int
    name: str
    display_name: str
    description: str
    effect_category: int
    published: bool
    is_offensive: bool
    is_assistance: bool
    is_warp_safe: bool
    references: tuple[int, ...]
    modifier_info: tuple[dict[str, Any], ...]


@dataclass(frozen=True, slots=True)
class NpcType:
    type_id: int
    name: str
    group_id: int
    group_name: str
    category_id: int
    published: bool
    classification: str
    configured_profiles: tuple[str, ...]
    spawn_references: tuple[str, ...]
    dogma_record: dict[str, Any] | None
    client_record: dict[str, Any]
    shadowed_fields: tuple[str, ...] = ()

    @property
    def configured(self) -> bool:
        return bool(self.configured_profiles)

    @property
    def spawnable(self) -> bool:
        return bool(self.spawn_references)


@dataclass(slots=True)
class AttributeOperation:
    attribute_id: int
    name: str
    action: AttributeAction
    before_value: float | None = None
    value: float | None = None
    source_type_id: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "attributeID": self.attribute_id,
            "name": self.name,
            "action": self.action,
            "beforeValue": self.before_value,
            "value": self.value,
            "sourceTypeID": self.source_type_id,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "AttributeOperation":
        return cls(
            attribute_id=int(value["attributeID"]),
            name=str(value.get("name") or ""),
            action=str(value["action"]),  # type: ignore[arg-type]
            before_value=_optional_float(value.get("beforeValue")),
            value=_optional_float(value.get("value")),
            source_type_id=_optional_int(value.get("sourceTypeID")),
        )


@dataclass(slots=True)
class EffectOperation:
    effect_id: int
    name: str
    action: EffectAction
    before_is_default: int | None = None
    is_default: int | None = None
    source_type_id: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "effectID": self.effect_id,
            "name": self.name,
            "action": self.action,
            "beforeIsDefault": self.before_is_default,
            "isDefault": self.is_default,
            "sourceTypeID": self.source_type_id,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "EffectOperation":
        return cls(
            effect_id=int(value["effectID"]),
            name=str(value.get("name") or ""),
            action=str(value["action"]),  # type: ignore[arg-type]
            before_is_default=_optional_int(value.get("beforeIsDefault")),
            is_default=_optional_int(value.get("isDefault")),
            source_type_id=_optional_int(value.get("sourceTypeID")),
        )


@dataclass(slots=True)
class TargetEdit:
    target_type_id: int
    target_name: str
    source_type_id: int | None
    published: bool
    classification: str
    attributes: list[AttributeOperation] = field(default_factory=list)
    effects: list[EffectOperation] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "targetTypeID": self.target_type_id,
            "targetName": self.target_name,
            "sourceTypeID": self.source_type_id,
            "published": self.published,
            "classification": self.classification,
            "attributes": [item.to_dict() for item in self.attributes],
            "effects": [item.to_dict() for item in self.effects],
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "TargetEdit":
        return cls(
            target_type_id=int(value["targetTypeID"]),
            target_name=str(value.get("targetName") or ""),
            source_type_id=_optional_int(value.get("sourceTypeID")),
            published=bool(value.get("published")),
            classification=str(value.get("classification") or "unresolved"),
            attributes=[
                AttributeOperation.from_dict(item)
                for item in value.get("attributes", [])
            ],
            effects=[
                EffectOperation.from_dict(item)
                for item in value.get("effects", [])
            ],
        )


@dataclass(slots=True)
class NpcDogmaProject:
    name: str
    build: int
    profile_id: str
    type_dogma_base_sha256: str
    edits: list[TargetEdit] = field(default_factory=list)
    project_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    notes: str = ""
    acknowledgements: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "format": PROJECT_FORMAT,
            "version": PROJECT_VERSION,
            "projectId": self.project_id,
            "name": self.name,
            "build": self.build,
            "profileId": self.profile_id,
            "typeDogmaBaseSha256": self.type_dogma_base_sha256,
            "notes": self.notes,
            "acknowledgements": list(self.acknowledgements),
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "edits": [item.to_dict() for item in self.edits],
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "NpcDogmaProject":
        if value.get("format") != PROJECT_FORMAT:
            raise ValueError("Not an Elysian NPC Dogma project")
        if int(value.get("version", 0)) != PROJECT_VERSION:
            raise ValueError("Unsupported NPC Dogma project version")
        return cls(
            project_id=str(value["projectId"]),
            name=str(value["name"]),
            build=int(value["build"]),
            profile_id=str(value["profileId"]),
            type_dogma_base_sha256=str(value["typeDogmaBaseSha256"]),
            notes=str(value.get("notes") or ""),
            acknowledgements=[str(item) for item in value.get("acknowledgements", [])],
            created_at=str(value.get("createdAt") or utc_now()),
            updated_at=str(value.get("updatedAt") or utc_now()),
            edits=[TargetEdit.from_dict(item) for item in value.get("edits", [])],
        )


def _optional_int(value: Any) -> int | None:
    return None if value is None else int(value)


def _optional_float(value: Any) -> float | None:
    return None if value is None else float(value)


def save_project(project: NpcDogmaProject, path: Path) -> Path:
    path = Path(path)
    if path.suffix.casefold() != ".elysiannpcdogma":
        path = path.with_suffix(".elysiannpcdogma")
    path.parent.mkdir(parents=True, exist_ok=True)
    project.updated_at = utc_now()
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        temporary.write_text(
            json.dumps(project.to_dict(), indent=2, ensure_ascii=False) + "\n",
            "utf-8",
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def load_project(path: Path) -> NpcDogmaProject:
    value = json.loads(Path(path).read_text("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("NPC Dogma project root must be an object")
    return NpcDogmaProject.from_dict(value)


def project_json(project: NpcDogmaProject) -> str:
    return json.dumps(project.to_dict(), indent=2, ensure_ascii=False) + "\n"


def clone_project(project: NpcDogmaProject) -> NpcDogmaProject:
    return NpcDogmaProject.from_dict(json.loads(json.dumps(project.to_dict())))
