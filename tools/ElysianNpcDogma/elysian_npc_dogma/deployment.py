from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from elysian_fsd.bundle import BundleArtifact
from elysian_fsd.compiler import FsdCompiler
from elysian_fsd.deployment import (
    PreparedFsdBundle,
    apply_prepared_fsd_bundle,
    prepare_fsd_bundle,
    rollback_active_fsd_bundle,
)
from elysian_fsd.documents import DocumentLoader
from elysian_fsd.encoder_verification import EncoderVerifier
from elysian_fsd.evejs import server_data_root
from elysian_fsd.hashing import sha256_file
from elysian_fsd.native_loader import NativeLoaderHost
from elysian_fsd.project import FsdProject
from elysian_fsd.transaction import StagedArtifact, atomic_write_json

from .catalog import NpcDogmaCatalog
from .changes import build_document
from .models import NpcDogmaProject
from .server_projection import build_server_projection
from .validation import ValidationReport, validate_project


APPLICATION_NAME = "Elysian NPC Dogma Workbench"


@dataclass(slots=True)
class CompiledNpcDogma:
    document: object
    compiled: object
    server_projection: dict
    native_report: object
    validation: ValidationReport


def _normalized_assignment(value):
    if isinstance(value, dict):
        return {str(key): _normalized_assignment(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalized_assignment(item) for item in value]
    if isinstance(value, bool):
        return int(value)
    return value


def compile_project(
    catalog: NpcDogmaCatalog,
    project: NpcDogmaProject,
) -> CompiledNpcDogma:
    if catalog.profile is None:
        raise ValueError("Compilation requires a live client build profile")
    table = catalog.profile.table("typeDogma")
    validation = validate_project(
        catalog,
        project,
        current_source_sha256=sha256_file(table.resource_path),
    )
    if not validation.valid:
        raise ValueError(
            "Project validation failed:\n"
            + "\n".join(f"- {item.code}: {item.message}" for item in validation.errors)
        )
    document = build_document(catalog, project)
    if not document.change_set.changes:
        raise ValueError("The project does not change typeDogma")
    document_loader = DocumentLoader(catalog.profile, catalog.export_root)
    compiler = FsdCompiler(catalog.profile, documents=document_loader)
    gate = compiler.release_gate_issues(["typeDogma"])
    if gate:
        proof = EncoderVerifier(
            catalog.profile,
            compiler,
            document_loader=document_loader,
        ).verify("typeDogma")
        if not proof.success:
            details = "; ".join(proof.errors) or "native mutation parity failed"
            raise ValueError(f"Could not verify the typeDogma compiler: {details}")
        compiler = FsdCompiler(catalog.profile, documents=document_loader)
    compiled = compiler.compile(document)
    probes = [
        {"key": edit.target_type_id}
        for edit in project.edits
    ]
    with tempfile.TemporaryDirectory(prefix="elysian-npc-dogma-verify-") as temporary:
        candidate = Path(temporary) / "typeDogma.fsdbinary"
        candidate.write_bytes(compiled.payload)
        report = NativeLoaderHost(catalog.profile).verify_table(
            "typeDogma",
            resource_path=candidate,
            probes=probes,
            persist=False,
        )
    if not report.success:
        raise ValueError(f"Native typeDogma verification failed: {report.error}")
    if len(report.probes) != len(project.edits):
        raise ValueError("Native verification did not return every target probe")
    for edit, probe in zip(project.edits, report.probes, strict=True):
        if not probe.get("present"):
            raise ValueError(f"Native result is missing typeDogma[{edit.target_type_id}]")
        expected = _normalized_assignment(document.records[edit.target_type_id])
        actual = _normalized_assignment(probe.get("value"))
        if actual != expected:
            raise ValueError(
                f"Native result for typeDogma[{edit.target_type_id}] does not match the requested record"
            )
    data_path = server_data_root(catalog.server_root) / "typeDogma" / "data.json"
    existing = {}
    if data_path.is_file():
        try:
            value = json.loads(data_path.read_text("utf-8"))
            existing = value if isinstance(value, dict) else {}
        except (OSError, ValueError):
            existing = {}
    projection = build_server_projection(catalog, document, existing=existing)
    return CompiledNpcDogma(document, compiled, projection, report, validation)


def prepare_bundle(
    catalog: NpcDogmaCatalog,
    project: NpcDogmaProject,
    candidate: CompiledNpcDogma,
    destination: Path,
) -> PreparedFsdBundle:
    if catalog.profile is None:
        raise ValueError("Deployment requires a live client build profile")
    fsd_project = FsdProject(
        project_id=project.project_id,
        name=project.name,
        build=project.build,
        profile_id=project.profile_id,
        change_sets={"typeDogma": candidate.document.change_set},
        notes=project.notes,
    )
    bundle = prepare_fsd_bundle(
        catalog.profile,
        fsd_project,
        destination,
        server_root=catalog.server_root,
        precompiled_resources={"typeDogma": candidate.compiled},
        application_name=APPLICATION_NAME,
        export_root=catalog.export_root,
    )
    server_target = server_data_root(catalog.server_root) / "typeDogma" / "data.json"
    staged = bundle.root / "server" / "typeDogma" / "data.json"
    staged.parent.mkdir(parents=True, exist_ok=True)
    staged.write_text(
        json.dumps(candidate.server_projection, indent=2, ensure_ascii=False) + "\n",
        "utf-8",
    )
    digest = sha256_file(staged)
    bundle.artifacts.append(
        StagedArtifact(
            "server-static:typeDogma/data.json",
            server_target,
            staged,
            digest,
            "server",
        )
    )
    bundle.manifest.artifacts.append(
        BundleArtifact(
            "server-static:typeDogma/data.json",
            str(server_target),
            "server",
            sha256_file(server_target) if server_target.is_file() else None,
            digest,
            created_payload=not server_target.exists(),
        )
    )
    bundle.manifest.required_restarts = ["EVE client", "EveJS server"]
    atomic_write_json(bundle.manifest_path, bundle.manifest.to_dict())
    return bundle


def apply_bundle(
    bundle: PreparedFsdBundle,
    *,
    server_root: Path,
    progress_detail: Callable[[str, int, int], None] | None = None,
) -> Path:
    return apply_prepared_fsd_bundle(
        bundle,
        server_root=server_root,
        progress_detail=progress_detail,
        application_name=APPLICATION_NAME,
    )


def rollback(
    *,
    server_root: Path,
    progress_detail: Callable[[str, int, int], None] | None = None,
) -> None:
    rollback_active_fsd_bundle(
        server_root=server_root,
        progress_detail=progress_detail,
        application_name=APPLICATION_NAME,
    )
