from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from elysian_fsd.discovery import discover_build_profile
from elysian_fsd.evejs import server_data_root
from elysian_fsd.exports import discover_export_root, table_export_path
from elysian_fsd.jsonlines import load_jsonl_table
from elysian_fsd.localization import NameIdResolver
from elysian_fsd.models import BuildProfile

from .models import AttributeDefinition, EffectDefinition, NpcType
from .presets import EFFECT_ATTRIBUTE_FIELDS


_NON_SHIP_GROUP_TOKENS = (
    "container",
    "structure",
    "billboard",
    "cloud",
    "capture point",
    "infrastructure hub",
    "cache",
    "terminal",
    "sentry gun",
    "belongings",
)
_SHIP_GROUP_TOKENS = (
    "frigate",
    "destroyer",
    "cruiser",
    "battlecruiser",
    "battleship",
    "dreadnought",
    "carrier",
    "supercarrier",
    "titan",
    "hauler",
    "industrial",
    "freighter",
    "shuttle",
    "drone",
    "fighter",
    "convoy",
    "police",
    "entity",
    "entities",
    "mooneater",
    "xeroti",
)
_NPC_SIGNAL_ATTRIBUTES = frozenset({9, 37, 55, 70, 76, 192, 263, 265, 479, 482, 552, 564})
_REQUIRED_EXPORT_TABLES = (
    "types",
    "groups",
    "typeDogma",
    "dogmaAttributes",
    "dogmaEffects",
)


def localized(value: Any, fallback: str = "") -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("en", "en-us", "en_US"):
            if value.get(key):
                return str(value[key])
        for item in value.values():
            if item:
                return str(item)
    return fallback


def _keyed_table(export_root: Path, name: str) -> dict[int, dict[str, Any]]:
    path = table_export_path(export_root, name)
    if path is None:
        raise FileNotFoundError(f"Missing {name}.jsonl in {export_root}")
    value = load_jsonl_table(path)
    if not isinstance(value, dict):
        raise TypeError(f"{name} must be a keyed table")
    return {int(key): dict(row) for key, row in value.items()}


def _private_export_is_current(profile: BuildProfile, root: Path) -> bool:
    manifest = root / "_npc_dogma_export.json"
    try:
        value = json.loads(manifest.read_text("utf-8"))
        expected = {
            profile.table(name).name.casefold(): profile.table(name).resource_md5
            for name in _REQUIRED_EXPORT_TABLES
        }
        return (
            int(value.get("build", 0)) == profile.build
            and value.get("resources") == expected
            and all(table_export_path(root, name) is not None for name in _REQUIRED_EXPORT_TABLES)
        )
    except (OSError, TypeError, ValueError):
        return False


def _write_private_export_manifest(profile: BuildProfile, root: Path) -> None:
    value = {
        "format": "elysian-npc-dogma-export",
        "version": 1,
        "build": profile.build,
        "profileId": profile.profile_id,
        "resources": {
            profile.table(name).name.casefold(): profile.table(name).resource_md5
            for name in _REQUIRED_EXPORT_TABLES
        },
    }
    path = root / "_npc_dogma_export.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", "utf-8")
    os.replace(temporary, path)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text("utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, TypeError, ValueError):
        return {}


def _server_repo_root(server_root: Path) -> Path:
    value = Path(server_root).resolve()
    return value.parent if value.name.casefold() == "server" else value


def _authority_document(server_root: Path, table_name: str) -> dict[str, Any]:
    data_path = server_data_root(server_root) / table_name / "data.json"
    if data_path.is_file():
        return _read_json(data_path)
    fallback = (
        _server_repo_root(server_root)
        / "tools"
        / "DatabaseCreator"
        / "staticTables"
        / table_name
        / "data.json"
    )
    return _read_json(fallback)


def _records(document: dict[str, Any], plural: str) -> list[dict[str, Any]]:
    value = document.get(plural, [])
    return [dict(item) for item in value if isinstance(item, dict)]


def _walk_profile_references(value: Any, profile_ids: set[str], path: str = ""):
    if isinstance(value, dict):
        for key, nested in value.items():
            nested_path = f"{path}.{key}" if path else str(key)
            if key == "profileID" and isinstance(nested, str) and nested in profile_ids:
                yield nested, nested_path
            yield from _walk_profile_references(nested, profile_ids, nested_path)
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            yield from _walk_profile_references(nested, profile_ids, f"{path}[{index}]")


def _profile_indexes(server_root: Path):
    profiles = _records(_authority_document(server_root, "npcProfiles"), "profiles")
    capital = _authority_document(server_root, "capitalNpcAuthority")
    for entry in capital.get("entries", []):
        if not isinstance(entry, dict):
            continue
        profile = dict(entry)
        profile.setdefault("profileID", entry.get("profileID"))
        profiles.append(profile)

    by_type: dict[int, list[str]] = defaultdict(list)
    shadowed: dict[int, set[str]] = defaultdict(set)
    profile_ids: set[str] = set()
    for profile in profiles:
        profile_id = str(profile.get("profileID") or "").strip()
        type_id = int(profile.get("shipTypeID") or 0)
        if not profile_id or not type_id:
            continue
        profile_ids.add(profile_id)
        by_type[type_id].append(profile_id)
        restrictions = profile.get("npcFittingRestrictions")
        if isinstance(restrictions, dict):
            for name in ("roleSlots", "cpuOutput", "powerOutput"):
                if name in restrictions:
                    shadowed[type_id].add(name)

    spawn_refs: dict[str, list[str]] = defaultdict(list)
    for table_name in (
        "npcSpawnPools",
        "npcSpawnGroups",
        "npcStartupRules",
        "dungeonAuthority",
    ):
        document = _authority_document(server_root, table_name)
        for profile_id, path in _walk_profile_references(document, profile_ids):
            spawn_refs[profile_id].append(f"{table_name}:{path}")
    return by_type, shadowed, spawn_refs


def _classify(
    category_id: int,
    group_name: str,
    dogma_record: dict[str, Any] | None,
    configured: bool,
) -> str:
    if category_id == 6 and configured:
        return "player_hull_used_by_npc"
    if category_id != 11:
        return "unresolved" if configured else "other"
    normalized = group_name.casefold()
    if any(token in normalized for token in _NON_SHIP_GROUP_TOKENS):
        return "structure_or_container"
    if any(token in normalized for token in _SHIP_GROUP_TOKENS):
        return "npc_ship"
    attributes = {
        int(item.get("attributeID") or 0)
        for item in (dogma_record or {}).get("dogmaAttributes", [])
        if isinstance(item, dict)
    }
    if len(attributes & _NPC_SIGNAL_ATTRIBUTES) >= 5:
        return "npc_ship"
    return "other_entity"


def _effect_references(row: dict[str, Any]) -> tuple[int, ...]:
    references: set[int] = set()
    for field in EFFECT_ATTRIBUTE_FIELDS:
        value = int(row.get(field) or 0)
        if value > 0:
            references.add(value)
    for modifier in row.get("modifierInfo", []):
        if not isinstance(modifier, dict):
            continue
        for field in ("modifiedAttributeID", "modifyingAttributeID"):
            value = int(modifier.get(field) or 0)
            if value > 0:
                references.add(value)
    return tuple(sorted(references))


class NpcDogmaCatalog:
    def __init__(
        self,
        profile: BuildProfile | None,
        export_root: Path,
        server_root: Path,
        types: dict[int, dict[str, Any]],
        groups: dict[int, dict[str, Any]],
        type_dogma: dict[int, dict[str, Any]],
        attribute_rows: dict[int, dict[str, Any]],
        effect_rows: dict[int, dict[str, Any]],
        name_resolver: NameIdResolver | None = None,
    ) -> None:
        self.profile = profile
        self.export_root = Path(export_root)
        self.server_root = Path(server_root)
        self.types = types
        self.groups = groups
        self.type_dogma = type_dogma
        self.attribute_rows = attribute_rows
        self.effect_rows = effect_rows
        self.name_resolver = name_resolver
        self.attributes = self._make_attributes()
        self.attributes_by_name = {
            item.name.casefold(): item for item in self.attributes.values() if item.name
        }
        self.effects = self._make_effects()
        self.npcs, self.player_ships = self._make_types()
        self.by_type_id = {
            item.type_id: item for item in (*self.npcs, *self.player_ships)
        }

    @classmethod
    def load(cls, client_root: Path, server_root: Path) -> "NpcDogmaCatalog":
        profile = discover_build_profile(client_root)
        export_root = discover_export_root(profile.build)
        from elysian_fsd.native_export import export_client_tables, export_is_current
        try:
            resolver = NameIdResolver.from_profile(profile)
        except (OSError, TypeError, ValueError):
            resolver = None
        if export_root and (not profile.is_frontier or export_is_current(profile, export_root)):
            try:
                return cls.from_export(
                    export_root,
                    server_root,
                    profile=profile,
                    name_resolver=resolver,
                )
            except (OSError, TypeError, ValueError):
                pass

        from .paths import RUNTIME_ROOT

        export_root = RUNTIME_ROOT / "exports" / f"npc-dogma-{profile.build}-jsonl"
        if not _private_export_is_current(profile, export_root):
            export_client_tables(
                profile,
                _REQUIRED_EXPORT_TABLES,
                destination=export_root,
            )
            _write_private_export_manifest(profile, export_root)
        return cls.from_export(
            export_root,
            server_root,
            profile=profile,
            name_resolver=resolver,
        )

    @classmethod
    def from_export(
        cls,
        export_root: Path,
        server_root: Path,
        *,
        profile: BuildProfile | None = None,
        name_resolver: NameIdResolver | None = None,
    ) -> "NpcDogmaCatalog":
        export_root = Path(export_root)
        return cls(
            profile,
            export_root,
            server_root,
            _keyed_table(export_root, "types"),
            _keyed_table(export_root, "groups"),
            _keyed_table(export_root, "typeDogma"),
            _keyed_table(export_root, "dogmaAttributes"),
            _keyed_table(export_root, "dogmaEffects"),
            name_resolver,
        )

    @property
    def build(self) -> int:
        return int(self.profile.build) if self.profile else 0

    def resolve_name(
        self,
        row: dict[str, Any],
        field: str,
        message_field: str,
        fallback: str = "",
    ) -> str:
        direct = localized(row.get(field))
        if direct:
            return direct
        if self.name_resolver is not None:
            resolved = self.name_resolver.resolve(row.get(message_field))
            if resolved:
                return resolved
        return fallback

    def _make_attributes(self) -> dict[int, AttributeDefinition]:
        result: dict[int, AttributeDefinition] = {}
        for attribute_id, row in self.attribute_rows.items():
            result[attribute_id] = AttributeDefinition(
                attribute_id=attribute_id,
                name=str(row.get("name") or f"attribute_{attribute_id}"),
                display_name=self.resolve_name(
                    row,
                    "displayName",
                    "displayNameID",
                    str(row.get("name") or ""),
                ),
                description=self.resolve_name(row, "description", "descriptionID"),
                unit_id=int(row["unitID"]) if row.get("unitID") is not None else None,
                data_type=int(row.get("dataType") or 0),
                default_value=float(row.get("defaultValue") or 0),
                published=bool(row.get("published")),
            )
        return result

    def _make_effects(self) -> dict[int, EffectDefinition]:
        result: dict[int, EffectDefinition] = {}
        for effect_id, row in self.effect_rows.items():
            result[effect_id] = EffectDefinition(
                effect_id=effect_id,
                name=str(row.get("effectName") or row.get("name") or f"effect_{effect_id}"),
                display_name=self.resolve_name(row, "displayName", "displayNameID"),
                description=self.resolve_name(row, "description", "descriptionID"),
                effect_category=int(row.get("effectCategory") or row.get("effectCategoryID") or 0),
                published=bool(row.get("published")),
                is_offensive=bool(row.get("isOffensive")),
                is_assistance=bool(row.get("isAssistance")),
                is_warp_safe=bool(row.get("isWarpSafe")),
                references=_effect_references(row),
                modifier_info=tuple(
                    dict(item) for item in row.get("modifierInfo", []) if isinstance(item, dict)
                ),
            )
        return result

    def _make_types(self) -> tuple[list[NpcType], list[NpcType]]:
        profile_types, shadowed, spawn_refs = _profile_indexes(self.server_root)
        npc_rows: list[NpcType] = []
        player_rows: list[NpcType] = []
        for type_id, record in self.types.items():
            group_id = int(record.get("groupID") or 0)
            group = self.groups.get(group_id, {})
            category_id = int(group.get("categoryID") or record.get("categoryID") or 0)
            configured_profiles = tuple(sorted(set(profile_types.get(type_id, []))))
            if category_id not in {6, 11} and not configured_profiles:
                continue
            group_name = self.resolve_name(
                group,
                "name",
                "groupNameID",
                f"Group {group_id}",
            )
            dogma = self.type_dogma.get(type_id)
            refs = tuple(
                sorted(
                    {
                        reference
                        for profile_id in configured_profiles
                        for reference in spawn_refs.get(profile_id, [])
                    }
                )
            )
            item = NpcType(
                type_id=type_id,
                name=self.resolve_name(
                    record,
                    "name",
                    "typeNameID",
                    f"Type {type_id}",
                ),
                group_id=group_id,
                group_name=group_name,
                category_id=category_id,
                published=bool(record.get("published")),
                classification=_classify(category_id, group_name, dogma, bool(configured_profiles)),
                configured_profiles=configured_profiles,
                spawn_references=refs,
                dogma_record=dogma,
                client_record=record,
                shadowed_fields=tuple(sorted(shadowed.get(type_id, set()))),
            )
            if category_id == 6:
                player_rows.append(item)
                if configured_profiles:
                    npc_rows.append(item)
            elif category_id == 11 or configured_profiles:
                npc_rows.append(item)
        key = lambda item: (item.name.casefold(), item.type_id)
        return sorted(npc_rows, key=key), sorted(player_rows, key=key)

    def attribute_values(self, type_id: int) -> dict[int, float]:
        row = self.type_dogma.get(int(type_id), {})
        result: dict[int, float] = {}
        for item in row.get("dogmaAttributes", []):
            if not isinstance(item, dict):
                continue
            result[int(item.get("attributeID") or 0)] = float(item.get("value") or 0)
        return result

    def effect_values(self, type_id: int) -> dict[int, int]:
        row = self.type_dogma.get(int(type_id), {})
        result: dict[int, int] = {}
        for item in row.get("dogmaEffects", []):
            if not isinstance(item, dict):
                continue
            result[int(item.get("effectID") or 0)] = int(item.get("isDefault") or 0)
        return result

    def summary(self) -> dict[str, Any]:
        entity_types = [
            item for item in self.npcs if item.category_id == 11
        ]
        return {
            "build": self.build,
            "npcRows": len(self.npcs),
            "entityTypes": len(entity_types),
            "publishedEntityTypes": sum(item.published for item in entity_types),
            "hiddenEntityTypes": sum(not item.published for item in entity_types),
            "configuredTypes": sum(item.configured for item in self.npcs),
            "spawnableTypes": sum(item.spawnable for item in self.npcs),
            "playerShipSources": len(self.player_ships),
            "attributes": len(self.attributes),
            "effects": len(self.effects),
        }


def find_source_suggestions(
    target: NpcType,
    sources: Iterable[NpcType],
    *,
    limit: int = 8,
) -> list[NpcType]:
    target_tokens = set(target.name.casefold().replace("'", "").split())

    def score(source: NpcType) -> tuple[int, str, int]:
        points = 0
        if target.client_record.get("graphicID") and (
            target.client_record.get("graphicID") == source.client_record.get("graphicID")
        ):
            points += 40
        if target.client_record.get("raceID") and (
            target.client_record.get("raceID") == source.client_record.get("raceID")
        ):
            points += 10
        source_tokens = set(source.name.casefold().replace("'", "").split())
        points += 6 * len(target_tokens & source_tokens)
        for hull in ("frigate", "destroyer", "cruiser", "battlecruiser", "battleship", "dreadnought", "carrier", "titan", "shuttle"):
            if hull in target.group_name.casefold() and hull in source.group_name.casefold():
                points += 20
        return (-points, source.name.casefold(), source.type_id)

    return sorted(sources, key=score)[:limit]
