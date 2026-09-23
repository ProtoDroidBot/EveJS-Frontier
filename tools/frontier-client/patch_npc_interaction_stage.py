"""Update only the NPC interaction menu in a verified build-3502403 stage.

The broader fitting patch may contain independent pending client changes. This
transaction deliberately replaces only menusvc.pyc and verifies every other
archive member before accepting the new stage metadata.
"""

import argparse
import hashlib
import marshal
from pathlib import Path
import re
import sys
import zipfile

import frontier_windows_client as stage
import patch_frontier_features as features
import patch_frontier_fitting as fitting


BASELINE_MENU_MEMBER_SHA256 = (
    "6642bda82979549d32ba85c3a5bd02b8fe74beca374ee3536fd1b53ac356a964"
)
BASELINE_MENU_ADAPTER_SHA256 = (
    "5c3807108a7bbbf0f6cda9746d05950a90e812ae46e01f3003651e9f6ca76a4f"
)


def inspect_menu_member(archive_path):
    with zipfile.ZipFile(archive_path) as archive:
        entries = [entry for entry in archive.infolist()
                   if entry.filename == fitting.MENU_MODULE_NAME]
        if len(entries) != 1:
            raise stage.FrontierWindowsError("Expected exactly one NPC menu member")
        member = archive.read(entries[0])
    if hashlib.sha256(member).hexdigest() != BASELINE_MENU_MEMBER_SHA256:
        raise stage.FrontierWindowsError("NPC menu changed since known preflight")
    state, original = fitting.inspect_member(
        member,
        fitting.MENU_SOURCE_MEMBER_SHA256,
        fitting.patched_menu_member,
        {BASELINE_MENU_MEMBER_SHA256},
    )
    if state != "outdated":
        raise stage.FrontierWindowsError("NPC menu is not the expected prior adapter")
    wrapper = marshal.loads(member[16:])
    adapters = [value for value in wrapper.co_consts
                if isinstance(value, bytes) and value != original]
    if len(adapters) != 1 or hashlib.sha256(adapters[0]).hexdigest() != (
        BASELINE_MENU_ADAPTER_SHA256
    ):
        raise stage.FrontierWindowsError("NPC menu adapter does not match preflight")
    return original


def verify_patched_menu_member(archive_path, original):
    with zipfile.ZipFile(archive_path) as archive:
        member = archive.read(fitting.MENU_MODULE_NAME)
    if member != fitting.patched_menu_member(original):
        raise stage.FrontierWindowsError("NPC menu patch failed verification")


def verify_archive_delta(before_path, after_path):
    changed = []
    with zipfile.ZipFile(before_path) as before, zipfile.ZipFile(after_path) as after:
        old_entries = before.infolist()
        new_entries = after.infolist()
        if [entry.filename for entry in old_entries] != [
            entry.filename for entry in new_entries
        ]:
            raise stage.FrontierWindowsError("Archive member order or names changed")
        for old_entry, new_entry in zip(old_entries, new_entries):
            if hashlib.sha256(before.read(old_entry)).digest() != hashlib.sha256(
                after.read(new_entry)
            ).digest():
                changed.append(old_entry.filename)
    if changed != [fitting.MENU_MODULE_NAME]:
        raise stage.FrontierWindowsError(
            f"Expected only the NPC menu member to change, got {changed!r}"
        )
    return changed


def patch(stage_root, expected_code_sha256):
    if sys.version_info[:2] != (3, 12):
        raise stage.FrontierWindowsError("Python 3.12 is required for client bytecode")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_code_sha256):
        raise stage.FrontierWindowsError("Expected code.ccp SHA-256 is invalid")
    stage_root = Path(stage_root).resolve()
    marker_path, marker = stage.load_stage(stage_root)
    if marker.get("patchState") != "complete" or int(marker.get("build", 0)) != 3502403:
        raise stage.FrontierWindowsError("Only a completed build-3502403 stage is supported")
    paths = stage.stage_paths(stage_root, marker)
    stage.assert_protected_stage_paths(stage_root, paths)
    if stage.sha256_file(paths["code"]) != expected_code_sha256:
        raise stage.FrontierWindowsError("code.ccp changed since preflight inspection")

    _, profile = stage.resolve_profile(3502403, str(marker["nativeBlue"]))
    if marker.get("currentHashes", {}).get("code.ccp") != expected_code_sha256:
        raise stage.FrontierWindowsError("Stage marker disagrees with code.ccp")
    if not stage.manifest_hashes_match(paths["manifest"], stage_root, profile):
        raise stage.FrontierWindowsError("Stage manifest does not verify")
    original_menu = inspect_menu_member(paths["code"])
    touched = [paths["code"], paths["manifest"], marker_path]
    backup_root, original_hashes = stage.backup_transaction_files(stage_root, touched)
    if any(
        stage.sha256_file(path) != original_hashes[path.relative_to(stage_root).as_posix()]
        for path in touched
    ):
        raise stage.FrontierWindowsError("Stage changed before NPC menu write")
    try:
        features.rewrite_archive(
            paths["code"],
            {fitting.MENU_MODULE_NAME: fitting.patched_menu_member(original_menu)},
        )
        changed = verify_archive_delta(
            backup_root / paths["code"].relative_to(stage_root), paths["code"]
        )
        stage.refresh_manifest_atomic(paths["manifest"], stage_root, profile)
        for path in (paths["code"], paths["manifest"]):
            marker["currentHashes"][path.relative_to(stage_root).as_posix()] = (
                stage.sha256_file(path)
            )
        marker["npcInteractionPatchBackup"] = str(backup_root)
        marker["preNpcInteractionHashes"] = original_hashes
        stage.write_json_atomic(marker_path, marker)
        verify_patched_menu_member(paths["code"], original_menu)
        if not stage.manifest_hashes_match(paths["manifest"], stage_root, profile):
            raise stage.FrontierWindowsError("Updated stage manifest does not verify")
        if stage.sha256_file(paths["code"]) != marker["currentHashes"]["code.ccp"]:
            raise stage.FrontierWindowsError("Updated stage marker does not verify")
        return {
            "backup": str(backup_root),
            "changedMembers": changed,
            "codeCcpSha256": marker["currentHashes"]["code.ccp"],
            "valid": True,
        }
    except BaseException:
        changed_paths = [
            path for path in touched
            if stage.sha256_file(path) != original_hashes[path.relative_to(stage_root).as_posix()]
        ]
        if changed_paths:
            stage.restore_transaction_files(
                stage_root, backup_root, changed_paths, original_hashes
            )
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged-root", type=Path, required=True)
    parser.add_argument("--expected-code-sha256", required=True)
    args = parser.parse_args()
    try:
        print(patch(args.staged_root, args.expected_code_sha256.lower()))
    except (stage.FrontierWindowsError, fitting.FittingPatchError,
            features.FeaturePatchError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f"[evejs-frontier] {error}\n")


if __name__ == "__main__":
    main()
