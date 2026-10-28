from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

from elysian_fsd.hashing import sha256_file

from .catalog import NpcDogmaCatalog
from .changes import make_copy_edit, semantic_diff
from .deployment import apply_bundle, compile_project, prepare_bundle, rollback
from .models import NpcDogmaProject, load_project, save_project
from .paths import default_client_root, default_server_root, ensure_directories
from .presets import CORE_ATTRIBUTE_NAMES
from .validation import format_report, validate_project


def _path(value: str) -> Path:
    return Path(value).expanduser().resolve()


def _catalog(args, *, require_profile: bool = False) -> NpcDogmaCatalog:
    server = _path(args.server) if getattr(args, "server", None) else default_server_root()
    export = getattr(args, "export_root", None)
    if export and not require_profile:
        return NpcDogmaCatalog.from_export(_path(export), server)
    client = _path(args.client) if getattr(args, "client", None) else default_client_root()
    return NpcDogmaCatalog.load(client, server)


def _matches(item, args) -> bool:
    if getattr(args, "published", False) and not item.published:
        return False
    if getattr(args, "hidden", False) and item.published:
        return False
    if getattr(args, "configured", False) and not item.configured:
        return False
    if getattr(args, "spawnable", False) and not item.spawnable:
        return False
    if not getattr(args, "all_entities", False) and item.classification not in {
        "npc_ship",
        "player_hull_used_by_npc",
    }:
        return False
    query = str(getattr(args, "query", "") or "").casefold().strip()
    return not query or query in f"{item.type_id} {item.name} {item.group_name}".casefold()


def command_scan(args) -> int:
    catalog = _catalog(args)
    rows = [item for item in catalog.npcs if _matches(item, args)]
    if args.json:
        print(
            json.dumps(
                {
                    "summary": catalog.summary(),
                    "rows": [
                        {
                            "typeID": item.type_id,
                            "name": item.name,
                            "groupID": item.group_id,
                            "groupName": item.group_name,
                            "categoryID": item.category_id,
                            "published": item.published,
                            "classification": item.classification,
                            "configuredProfiles": list(item.configured_profiles),
                            "spawnReferences": list(item.spawn_references),
                            "hasTypeDogma": item.dogma_record is not None,
                            "shadowedFields": list(item.shadowed_fields),
                        }
                        for item in rows
                    ],
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        summary = catalog.summary()
        print(
            f"Build {summary['build']}: {summary['entityTypes']} entity types "
            f"({summary['publishedEntityTypes']} published, {summary['hiddenEntityTypes']} hidden); "
            f"{summary['configuredTypes']} configured NPC hulls"
        )
        for item in rows:
            flags = ["published" if item.published else "hidden", item.classification]
            if item.configured:
                flags.append("configured")
            if item.spawnable:
                flags.append("spawnable")
            if item.dogma_record is None:
                flags.append("no-dogma")
            print(f"{item.type_id}\t{item.name}\t{item.group_name}\t{','.join(flags)}")
    return 0


def command_create(args) -> int:
    catalog = _catalog(args, require_profile=True)
    if catalog.profile is None:
        raise ValueError("A live client is required")
    attributes = tuple(
        item.strip() for item in (args.attributes or ",".join(CORE_ATTRIBUTE_NAMES)).split(",") if item.strip()
    )
    effects = tuple(int(item) for item in (args.effects or "").split(",") if item.strip())
    edits = [
        make_copy_edit(catalog, target, args.source, attributes, effects)
        for target in args.target
    ]
    project = NpcDogmaProject(
        name=args.name or "NPC Dogma changes",
        build=catalog.profile.build,
        profile_id=catalog.profile.profile_id,
        type_dogma_base_sha256=sha256_file(catalog.profile.table("typeDogma").resource_path),
        edits=edits,
    )
    output = save_project(project, _path(args.output))
    print(output)
    print(semantic_diff(catalog, project), end="")
    return 0


def _load_and_catalog(args):
    project = load_project(_path(args.project))
    catalog = _catalog(args, require_profile=True)
    return project, catalog


def command_validate(args) -> int:
    project, catalog = _load_and_catalog(args)
    current_sha = sha256_file(catalog.profile.table("typeDogma").resource_path) if catalog.profile else None
    report = validate_project(catalog, project, current_source_sha256=current_sha)
    print(format_report(report), end="")
    return 0 if report.valid else 2


def command_diff(args) -> int:
    project, catalog = _load_and_catalog(args)
    print(semantic_diff(catalog, project), end="")
    return 0


def command_compile(args) -> int:
    project, catalog = _load_and_catalog(args)
    candidate = compile_project(catalog, project)
    output = _path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    (output / "typeDogma.fsdbinary").write_bytes(candidate.compiled.payload)
    (output / "typeDogma.data.json").write_text(
        json.dumps(candidate.server_projection, indent=2, ensure_ascii=False) + "\n",
        "utf-8",
    )
    (output / "diff.txt").write_text(semantic_diff(catalog, project), "utf-8")
    print(f"Native verification passed; exported candidate to {output}")
    return 0


def command_apply(args) -> int:
    project, catalog = _load_and_catalog(args)
    candidate = compile_project(catalog, project)
    with tempfile.TemporaryDirectory(prefix="elysian-npc-dogma-bundle-") as temporary:
        bundle = prepare_bundle(catalog, project, candidate, Path(temporary) / "bundle")
        state = apply_bundle(bundle, server_root=catalog.server_root)
    print(f"Applied verified NPC Dogma project. Installation state: {state}")
    print("Restart the EVE client and EveJS server before testing.")
    return 0


def command_rollback(args) -> int:
    server = _path(args.server) if args.server else default_server_root()
    rollback(server_root=server)
    print("Rolled back the active NPC Dogma bundle.")
    return 0


def command_gui(_args) -> int:
    from .ui.app import run

    return run()


def _target_options(parser: argparse.ArgumentParser, *, export: bool = False) -> None:
    parser.add_argument("--client", help="Selected EVE client/channel root")
    parser.add_argument("--server", help="EveJS server or repository root")
    if export:
        parser.add_argument("--export-root", help="Existing ClientSDE JSONL export")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="elysian-npc-dogma")
    commands = parser.add_subparsers(dest="command", required=True)

    scan = commands.add_parser("scan", help="Inventory published and hidden NPCs")
    _target_options(scan, export=True)
    scan.add_argument("--json", action="store_true")
    scan.add_argument("--published", action="store_true")
    scan.add_argument("--hidden", action="store_true")
    scan.add_argument("--configured", action="store_true")
    scan.add_argument("--spawnable", action="store_true")
    scan.add_argument("--all-entities", action="store_true")
    scan.add_argument("--query", default="")
    scan.set_defaults(func=command_scan)

    create = commands.add_parser("create", help="Create a copy-from-player project")
    _target_options(create)
    create.add_argument("--target", type=int, action="append", required=True)
    create.add_argument("--source", type=int, required=True)
    create.add_argument("--attributes", help="Comma-separated canonical attribute names")
    create.add_argument("--effects", help="Comma-separated source effect IDs")
    create.add_argument("--name")
    create.add_argument("--output", required=True)
    create.set_defaults(func=command_create)

    for name, help_text, function in (
        ("validate", "Validate a project against the live target", command_validate),
        ("diff", "Print the semantic project diff", command_diff),
        ("apply", "Compile, verify, and transactionally install", command_apply),
    ):
        command = commands.add_parser(name, help=help_text)
        _target_options(command)
        command.add_argument("project")
        command.set_defaults(func=function)

    compile_command = commands.add_parser("compile", help="Compile and export without installing")
    _target_options(compile_command)
    compile_command.add_argument("project")
    compile_command.add_argument("--output", required=True)
    compile_command.set_defaults(func=command_compile)

    rollback_command = commands.add_parser("rollback", help="Rollback the active NPC Dogma bundle")
    rollback_command.add_argument("--server")
    rollback_command.set_defaults(func=command_rollback)

    gui = commands.add_parser("gui", help="Open the desktop workbench")
    gui.set_defaults(func=command_gui)
    return parser


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(errors="replace")
    ensure_directories()
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
