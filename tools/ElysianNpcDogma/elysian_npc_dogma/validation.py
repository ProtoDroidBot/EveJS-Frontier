from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from .catalog import NpcDogmaCatalog
from .changes import apply_target_edit
from .models import NpcDogmaProject
from .presets import INTEGER_ATTRIBUTE_NAMES, NON_NEGATIVE_ATTRIBUTE_NAMES


Severity = Literal["error", "warning"]


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    severity: Severity
    code: str
    message: str
    target_type_id: int | None = None


@dataclass(frozen=True, slots=True)
class ValidationReport:
    issues: tuple[ValidationIssue, ...]

    @property
    def valid(self) -> bool:
        return not any(item.severity == "error" for item in self.issues)

    @property
    def errors(self) -> tuple[ValidationIssue, ...]:
        return tuple(item for item in self.issues if item.severity == "error")

    @property
    def warnings(self) -> tuple[ValidationIssue, ...]:
        return tuple(item for item in self.issues if item.severity == "warning")


def validate_project(
    catalog: NpcDogmaCatalog,
    project: NpcDogmaProject,
    *,
    current_source_sha256: str | None = None,
) -> ValidationReport:
    issues: list[ValidationIssue] = []
    if catalog.profile and project.build != catalog.profile.build:
        issues.append(
            ValidationIssue(
                "error",
                "BUILD_MISMATCH",
                f"Project build {project.build} does not match client build {catalog.profile.build}",
            )
        )
    if current_source_sha256 and project.type_dogma_base_sha256 != current_source_sha256:
        issues.append(
            ValidationIssue(
                "error",
                "BASELINE_DRIFT",
                "The client's typeDogma resource changed after this project was created",
            )
        )
    if not project.edits:
        issues.append(ValidationIssue("error", "EMPTY_PROJECT", "The project has no target edits"))

    target_ids: set[int] = set()
    for edit in project.edits:
        target = catalog.by_type_id.get(edit.target_type_id)
        if edit.target_type_id in target_ids:
            issues.append(
                ValidationIssue(
                    "error", "DUPLICATE_TARGET", "A target appears more than once", edit.target_type_id
                )
            )
        target_ids.add(edit.target_type_id)
        if target is None:
            issues.append(
                ValidationIssue(
                    "error", "TARGET_MISSING", "Target type is absent from the current client", edit.target_type_id
                )
            )
            continue
        if target.classification in {"structure_or_container", "other_entity", "unresolved"}:
            issues.append(
                ValidationIssue(
                    "warning",
                    "NON_SHIP_TARGET",
                    f"{target.name} is classified as {target.classification}",
                    target.type_id,
                )
            )
        if target.published != edit.published:
            issues.append(
                ValidationIssue(
                    "error", "PUBLICATION_DRIFT", "Target publication state changed", target.type_id
                )
            )
        if target.shadowed_fields:
            issues.append(
                ValidationIssue(
                    "warning",
                    "FITTING_RESTRICTIONS_SHADOW_DOGMA",
                    "NPC fitting restrictions may shadow: " + ", ".join(target.shadowed_fields),
                    target.type_id,
                )
            )

        attribute_ids: set[int] = set()
        for operation in edit.attributes:
            definition = catalog.attributes.get(operation.attribute_id)
            if operation.attribute_id in attribute_ids:
                issues.append(
                    ValidationIssue(
                        "error", "DUPLICATE_ATTRIBUTE", f"Duplicate attribute {operation.attribute_id}", target.type_id
                    )
                )
            attribute_ids.add(operation.attribute_id)
            if definition is None:
                issues.append(
                    ValidationIssue(
                        "error", "ATTRIBUTE_MISSING", f"Unknown attribute {operation.attribute_id}", target.type_id
                    )
                )
                continue
            if definition.name.casefold() != operation.name.casefold():
                issues.append(
                    ValidationIssue(
                        "error",
                        "ATTRIBUTE_IDENTITY_CHANGED",
                        f"Attribute {operation.attribute_id} is now {definition.name}, not {operation.name}",
                        target.type_id,
                    )
                )
            if operation.action == "set":
                if operation.value is None or not math.isfinite(float(operation.value)):
                    issues.append(
                        ValidationIssue("error", "ATTRIBUTE_VALUE_INVALID", f"{definition.name} needs a finite value", target.type_id)
                    )
                    continue
                if definition.name in NON_NEGATIVE_ATTRIBUTE_NAMES and operation.value < 0:
                    issues.append(
                        ValidationIssue("error", "ATTRIBUTE_NEGATIVE", f"{definition.name} cannot be negative", target.type_id)
                    )
                if definition.name in INTEGER_ATTRIBUTE_NAMES and not float(operation.value).is_integer():
                    issues.append(
                        ValidationIssue("error", "ATTRIBUTE_NOT_INTEGER", f"{definition.name} must be an integer", target.type_id)
                    )

        effect_ids: set[int] = set()
        resulting = apply_target_edit(target.dogma_record, edit)
        resulting_attributes = {
            int(item["attributeID"]) for item in resulting.get("dogmaAttributes", [])
        }
        for operation in edit.effects:
            if operation.effect_id in effect_ids:
                issues.append(
                    ValidationIssue("error", "DUPLICATE_EFFECT", f"Duplicate effect {operation.effect_id}", target.type_id)
                )
            effect_ids.add(operation.effect_id)
            definition = catalog.effects.get(operation.effect_id)
            if definition is None:
                issues.append(
                    ValidationIssue("error", "EFFECT_MISSING", f"Unknown effect {operation.effect_id}", target.type_id)
                )
                continue
            if definition.name.casefold() != operation.name.casefold():
                issues.append(
                    ValidationIssue(
                        "error",
                        "EFFECT_IDENTITY_CHANGED",
                        f"Effect {operation.effect_id} is now {definition.name}, not {operation.name}",
                        target.type_id,
                    )
                )
            if operation.action != "remove" and operation.is_default not in {0, 1}:
                issues.append(
                    ValidationIssue("error", "EFFECT_DEFAULT_INVALID", f"{definition.name} has invalid isDefault", target.type_id)
                )
            missing_references = [
                attribute_id
                for attribute_id in definition.references
                if attribute_id not in catalog.attributes
            ]
            if missing_references:
                issues.append(
                    ValidationIssue(
                        "error",
                        "EFFECT_DANGLING_ATTRIBUTE",
                        f"{definition.name} references missing attributes {missing_references}",
                        target.type_id,
                    )
                )
            inactive_references = [
                attribute_id
                for attribute_id in definition.references
                if attribute_id in catalog.attributes
                and attribute_id not in resulting_attributes
                and catalog.attributes[attribute_id].default_value == 0
            ]
            if operation.action != "remove" and inactive_references:
                issues.append(
                    ValidationIssue(
                        "warning",
                        "EFFECT_ATTRIBUTE_ABSENT",
                        f"{definition.name} uses target attributes with zero/absent values: {inactive_references}",
                        target.type_id,
                    )
                )
            if operation.action != "remove" and any(
                modifier.get("skillTypeID") for modifier in definition.modifier_info
            ):
                issues.append(
                    ValidationIssue(
                        "warning",
                        "PLAYER_SKILL_EFFECT_ON_NPC",
                        f"{definition.name} is skill-scoped and may not affect an NPC",
                        target.type_id,
                    )
                )

        values = {
            catalog.attributes[item["attributeID"]].name: float(item["value"])
            for item in resulting.get("dogmaAttributes", [])
            if item["attributeID"] in catalog.attributes
        }
        high_slots = values.get("hiSlots")
        if high_slots is not None:
            for hardpoint in ("launcherSlotsLeft", "turretSlotsLeft"):
                if values.get(hardpoint, 0) > high_slots:
                    issues.append(
                        ValidationIssue(
                            "warning",
                            "HARDPOINTS_EXCEED_HIGH_SLOTS",
                            f"{hardpoint} exceeds hiSlots on {target.name}",
                            target.type_id,
                        )
                    )
        if values.get("upgradeSlotsLeft") != values.get("rigSlots") and (
            "upgradeSlotsLeft" in values and "rigSlots" in values
        ):
            issues.append(
                ValidationIssue(
                    "warning", "RIG_SLOT_MISMATCH", "rigSlots and upgradeSlotsLeft differ", target.type_id
                )
            )

    return ValidationReport(tuple(issues))


def format_report(report: ValidationReport) -> str:
    if not report.issues:
        return "Validation passed with no warnings.\n"
    lines = []
    for issue in report.issues:
        target = f" typeID={issue.target_type_id}" if issue.target_type_id else ""
        lines.append(f"{issue.severity.upper()} {issue.code}{target}: {issue.message}")
    return "\n".join(lines) + "\n"
