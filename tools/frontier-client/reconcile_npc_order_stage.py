"""Reconcile an independently changed build-3502403 stage and upgrade NPC orders.

This intentionally accepts only code.ccp manifest/marker drift and only the two
known outdated NPC UI wrappers. It backs up the current archive and metadata,
verifies every unrelated ZIP member, and rolls back on failure.
"""

import argparse
import hashlib
from pathlib import Path
import re
import sys
import zipfile

import frontier_windows_client as stage
import patch_frontier_fitting as fitting


NPC_MEMBERS = frozenset((
    fitting.MENU_MODULE_NAME,
    fitting.PRIMARY_ACTION_MODULE_NAME,
))


def _verify_unrelated_members(before_path, after_path):
    changed = []
    with zipfile.ZipFile(before_path) as before, zipfile.ZipFile(after_path) as after:
        old_entries = before.infolist()
        new_entries = after.infolist()
        if [entry.filename for entry in old_entries] != [
            entry.filename for entry in new_entries
        ]:
            raise stage.FrontierWindowsError("Archive member order or names changed")
        for old_entry, new_entry in zip(old_entries, new_entries):
            old_digest = hashlib.sha256(before.read(old_entry)).digest()
            new_digest = hashlib.sha256(after.read(new_entry)).digest()
            if old_digest != new_digest:
                changed.append(old_entry.filename)
    if set(changed) != NPC_MEMBERS or len(changed) != len(NPC_MEMBERS):
        raise stage.FrontierWindowsError(
            f"Unexpected changed code.ccp members: {changed!r}"
        )
    return changed


def reconcile(stage_root, expected_code_sha256):
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
    code_hash = stage.sha256_file(paths["code"])
    if code_hash != expected_code_sha256:
        raise stage.FrontierWindowsError("code.ccp changed since the preflight inspection")

    states = stage.code_patch_states(paths["code"], 3502403)
    expected_states = stage.expected_code_states(3502403, "patched")
    expected_states["fittingCompatibility"] = "outdated"
    if states != expected_states:
        raise stage.FrontierWindowsError(f"Unexpected code patch states: {states!r}")
    _, members = fitting.inspect_archive(paths["code"])
    if {name for name, value in members.items() if value[0] == "outdated"} != NPC_MEMBERS:
        raise stage.FrontierWindowsError("Outdated fitting members are not just the NPC UI")

    _, profile = stage.resolve_profile(3502403, str(marker["nativeBlue"]))
    manifest_bytes = paths["manifest"].read_bytes()
    manifest = stage.parse_manifest(manifest_bytes)
    stale_targets = {
        local_path.resolve()
        for entry, local_path in stage.manifest_targets(profile, stage_root, manifest)
        if manifest_bytes[entry["digestOffset"]:entry["digestOffset"] + 32] !=
        hashlib.sha256(local_path.read_bytes()).digest()
    }
    if stale_targets != {paths["code"].resolve()}:
        raise stage.FrontierWindowsError("Manifest drift is not limited to code.ccp")
    current_hashes = marker.get("currentHashes")
    if not isinstance(current_hashes, dict):
        raise stage.FrontierWindowsError("Stage marker current hashes are missing")
    for path in stage.transaction_paths(paths)[:-1]:
        relative = path.relative_to(stage_root).as_posix()
        marker_hash = str(current_hashes.get(relative, "")).lower()
        actual_hash = stage.sha256_file(path)
        if path == paths["code"]:
            if marker_hash == actual_hash:
                raise stage.FrontierWindowsError("Code marker is not stale as expected")
        elif marker_hash != actual_hash:
            raise stage.FrontierWindowsError(f"Unexpected stage marker drift: {relative}")
    stage.verify_backup(stage_root, marker, stage.transaction_paths(paths))

    touched = [paths["code"], paths["manifest"], marker_path]
    backup_root, original_hashes = stage.backup_transaction_files(stage_root, touched)
    if any(
        stage.sha256_file(path) != original_hashes[path.relative_to(stage_root).as_posix()]
        for path in touched
    ):
        raise stage.FrontierWindowsError("Stage changed before reconciliation write")
    try:
        # Rebaseline only the already-changed code digest, then run the full
        # normal stage verifier before applying any new client bytecode.
        stage.refresh_manifest_atomic(paths["manifest"], stage_root, profile)
        current_hashes[paths["code"].relative_to(stage_root).as_posix()] = code_hash
        current_hashes[paths["manifest"].relative_to(stage_root).as_posix()] = (
            stage.sha256_file(paths["manifest"])
        )
        stage.write_json_atomic(marker_path, marker)
        stage.check_stage(stage_root, allow_fitting_compatibility_outdated=True)

        fitting.patch_archive(paths["code"], 3502403)
        changed = _verify_unrelated_members(
            backup_root / paths["code"].relative_to(stage_root), paths["code"]
        )
        stage.refresh_manifest_atomic(paths["manifest"], stage_root, profile)
        current_hashes[paths["code"].relative_to(stage_root).as_posix()] = (
            stage.sha256_file(paths["code"])
        )
        current_hashes[paths["manifest"].relative_to(stage_root).as_posix()] = (
            stage.sha256_file(paths["manifest"])
        )
        marker["fittingCompatibilityPatchState"] = "patched"
        marker["fittingCompatibilityPatchBackup"] = str(backup_root)
        marker["preFittingCompatibilityHashes"] = original_hashes
        stage.write_json_atomic(marker_path, marker)
        report = stage.check_stage(stage_root)
        return {
            "backup": str(backup_root),
            "changedMembers": changed,
            "codeCcpSha256": report["codeCcpSha256"],
            "valid": report["valid"],
        }
    except BaseException:
        stage.restore_transaction_files(stage_root, backup_root, touched, original_hashes)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged-root", type=Path, required=True)
    parser.add_argument("--expected-code-sha256", required=True)
    args = parser.parse_args()
    try:
        report = reconcile(args.staged_root, args.expected_code_sha256.lower())
    except (stage.FrontierWindowsError, fitting.FittingPatchError, OSError,
            zipfile.BadZipFile) as error:
        parser.exit(1, f"[evejs-frontier] {error}\n")
    print(report)


if __name__ == "__main__":
    main()
