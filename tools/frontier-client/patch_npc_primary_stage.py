"""Refresh only the NPC HUD adapter in a verified build-3502403 stage."""

import argparse
import hashlib
from pathlib import Path
import re
import sys
import zipfile

import frontier_windows_client as stage
import patch_frontier_features as features
import patch_frontier_fitting as fitting


BASELINE_PRIMARY_MEMBER_SHA256 = (
    "5bccc0d07b755bc8296a5a1001d91ca520a433d5521177b780c20e4a730ba743"
)


def inspect_primary_member(archive_path):
    with zipfile.ZipFile(archive_path) as archive:
        entries = [entry for entry in archive.infolist()
                   if entry.filename == fitting.PRIMARY_ACTION_MODULE_NAME]
        if len(entries) != 1:
            raise stage.FrontierWindowsError("Expected one NPC HUD member")
        member = archive.read(entries[0])
    if hashlib.sha256(member).hexdigest() != BASELINE_PRIMARY_MEMBER_SHA256:
        raise stage.FrontierWindowsError("NPC HUD member changed since preflight")
    state, original = fitting.inspect_member(
        member,
        fitting.PRIMARY_ACTION_SOURCE_MEMBER_SHA256,
        fitting.patched_primary_action_member,
        {BASELINE_PRIMARY_MEMBER_SHA256},
    )
    if state != "outdated":
        raise stage.FrontierWindowsError("NPC HUD is not the expected prior adapter")
    return original


def verify_archive_delta(before_path, after_path):
    changed = []
    with zipfile.ZipFile(before_path) as before, zipfile.ZipFile(after_path) as after:
        old_entries = before.infolist()
        new_entries = after.infolist()
        if [entry.filename for entry in old_entries] != [entry.filename for entry in new_entries]:
            raise stage.FrontierWindowsError("Archive member order or names changed")
        for old_entry, new_entry in zip(old_entries, new_entries):
            if hashlib.sha256(before.read(old_entry)).digest() != hashlib.sha256(
                    after.read(new_entry)).digest():
                changed.append(old_entry.filename)
    if changed != [fitting.PRIMARY_ACTION_MODULE_NAME]:
        raise stage.FrontierWindowsError(
            f"Expected only the NPC HUD member to change, got {changed!r}"
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
    if marker.get("currentHashes", {}).get("code.ccp") != expected_code_sha256:
        raise stage.FrontierWindowsError("Stage marker disagrees with code.ccp")
    _, profile = stage.resolve_profile(3502403, str(marker["nativeBlue"]))
    if not stage.manifest_hashes_match(paths["manifest"], stage_root, profile):
        raise stage.FrontierWindowsError("Stage manifest does not verify")
    original = inspect_primary_member(paths["code"])
    touched = [paths["code"], paths["manifest"], marker_path]
    backup_root, original_hashes = stage.backup_transaction_files(stage_root, touched)
    if any(stage.sha256_file(path) != original_hashes[path.relative_to(stage_root).as_posix()]
           for path in touched):
        raise stage.FrontierWindowsError("Stage changed before NPC HUD write")
    try:
        replacement = fitting.patched_primary_action_member(original)
        features.rewrite_archive(
            paths["code"], {fitting.PRIMARY_ACTION_MODULE_NAME: replacement}
        )
        changed = verify_archive_delta(
            backup_root / paths["code"].relative_to(stage_root), paths["code"]
        )
        with zipfile.ZipFile(paths["code"]) as archive:
            if archive.read(fitting.PRIMARY_ACTION_MODULE_NAME) != replacement:
                raise stage.FrontierWindowsError("NPC HUD patch failed verification")
        stage.refresh_manifest_atomic(paths["manifest"], stage_root, profile)
        for path in (paths["code"], paths["manifest"]):
            marker["currentHashes"][path.relative_to(stage_root).as_posix()] = (
                stage.sha256_file(path)
            )
        marker["npcPrimaryActionPatchBackup"] = str(backup_root)
        marker["preNpcPrimaryActionHashes"] = original_hashes
        stage.write_json_atomic(marker_path, marker)
        if not stage.manifest_hashes_match(paths["manifest"], stage_root, profile):
            raise stage.FrontierWindowsError("Updated stage manifest does not verify")
        if fitting.inspect_archive(paths["code"], 3502403)[0] != "patched":
            raise stage.FrontierWindowsError("Updated fitting patch did not verify")
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
