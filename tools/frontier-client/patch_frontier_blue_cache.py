#!/usr/bin/env python3
"""Explicit in-place native patch, separate from the full staged-client workflow.

Only blue.pyd and its exact launcher-indexed ResFiles entry are changed. The
official index, manifest, code archive, certificates, and configuration stay
untouched. Launcher repair can therefore restore the official cache content.
"""

from __future__ import annotations

import argparse
import configparser
import csv
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

import frontier_windows_client as windows


BACKUP_FORMAT = "evejs-frontier-native-cache-backup-v1"
REPORT_NAME = "native-cache-patch.json"


def resolve_pair(client_root: Path, build: int, profile_path: Path | None = None):
    client_root = Path(os.path.abspath(client_root))
    install_root = client_root.parent
    windows.assert_no_reparse_ancestors(install_root, client_root)
    start_ini = client_root / "start.ini"
    windows.assert_no_reparse_ancestors(install_root, start_ini)
    metadata = configparser.ConfigParser(interpolation=None)
    metadata.read_string(start_ini.read_text(encoding="utf-8-sig"))
    if metadata.getint("main", "build") != build or metadata.getint("main", "sync") != build:
        raise windows.FrontierWindowsError("Requested build does not match start.ini build/sync.")
    if metadata.get("main", "appname", fallback="").upper() != "FRONTIER":
        raise windows.FrontierWindowsError("Client is not an EVE Frontier installation.")
    resolved_profile, profile = windows.resolve_profile(build, "blue.pyd", profile_path)
    expected = profile.get("resourceCache")
    if not isinstance(expected, dict) or expected.get("logicalPath") != "app:/bin64/blue.pyd":
        raise windows.FrontierWindowsError("Profile has no exact native resource-cache mapping.")
    index_path = install_root / f"index_{client_root.name}.txt"
    windows.assert_no_reparse_ancestors(install_root, index_path)
    index_data = index_path.read_bytes()
    rows = list(csv.reader(index_data.decode("utf-8-sig").splitlines()))
    matches = [row for row in rows if row and row[0].replace("\\", "/").lower() == expected["logicalPath"]]
    if len(matches) != 1 or len(matches[0]) != 6:
        raise windows.FrontierWindowsError("Launcher index must contain exactly one six-field blue.pyd entry.")
    entry = matches[0]
    if (entry[1] != expected["cachePath"] or entry[2].lower() != expected["sourceMd5"]
            or int(entry[3]) != int(profile["source"]["size"])):
        raise windows.FrontierWindowsError("Launcher cache mapping does not match the exact build profile.")
    blue = client_root / "bin64/blue.pyd"
    cache = windows.safe_relative_path(install_root / "ResFiles", entry[1])
    for target in (blue, cache):
        windows.assert_no_reparse_ancestors(install_root, target)
        if not target.is_file():
            raise windows.FrontierWindowsError(f"Required native file is missing: {target}")
    if blue.samefile(cache):
        raise windows.FrontierWindowsError("Native file and cache must be distinct files, not hard links.")
    return install_root, [blue, cache], resolved_profile, profile, index_path, index_data


def inspect_pair(paths: list[Path], profile: dict) -> str:
    payloads = [path.read_bytes() for path in paths]
    states = [windows.inspect_blue_bytes(data, profile) for data in payloads]
    if len(set(states)) != 1 or states[0] not in {"source", "target"} or payloads[0] != payloads[1]:
        raise windows.FrontierWindowsError(f"Native/cache pair is mixed, partial, or unknown: {states}")
    if states[0] == "source" and hashlib.md5(payloads[0]).hexdigest() != profile["resourceCache"]["sourceMd5"]:
        raise windows.FrontierWindowsError("Exact source MD5 does not match the launcher cache index.")
    return states[0]


def process_pair(command: str, client_root: Path, build: int,
                 profile_path: Path | None = None, backup: Path | None = None) -> dict:
    root, paths, resolved_profile, profile, index_path, index_data = resolve_pair(client_root, build, profile_path)
    if command == "restore":
        # An interrupted two-file transaction can leave one source and one
        # target. Recover that known mixed state, but never overwrite unrelated
        # edits merely because a backup exists.
        states = [windows.inspect_blue(path, profile) for path in paths]
        if any(state not in {"source", "target"} for state in states):
            raise windows.FrontierWindowsError(f"Restore refuses unknown or partial file contents: {states}")
        state = states[0] if len(set(states)) == 1 else "mixed"
    else:
        state = inspect_pair(paths, profile)
    report = {
        "format": BACKUP_FORMAT,
        "build": build,
        "installRoot": str(root),
        "clientRoot": str(Path(os.path.abspath(client_root))),
        "profile": str(resolved_profile),
        "state": state,
        "files": [path.relative_to(root).as_posix() for path in paths],
        "sha256": windows.sha256_file(paths[0]),
        "index": str(index_path),
        "indexSha256": windows.sha256_bytes(index_data),
        "scope": "native-and-cache-only; index/manifest/code/configuration unchanged",
    }
    if command == "check":
        return report
    if command == "restore":
        if backup is None:
            raise windows.FrontierWindowsError("Restore requires --backup from the patch report.")
        _, backup = windows.checked_backup_root(root, backup)
        record_path = backup / REPORT_NAME
        windows.checked_backup_files(root, backup, [record_path])
        record = windows.read_json(record_path)
        for field in ("format", "build", "installRoot", "clientRoot", "files", "indexSha256"):
            if record.get(field) != report[field]:
                raise windows.FrontierWindowsError(f"Backup does not match the current pair: {field}")
        hashes = {relative: profile["source"]["sha256"] for relative in report["files"]}
        if record.get("prePatchHashes") != hashes:
            raise windows.FrontierWindowsError("Backup does not contain the exact supported originals.")
        windows.restore_transaction_files(root, backup, paths, hashes)
        report.update(state=inspect_pair(paths, profile), sha256=windows.sha256_file(paths[0]), backup=str(backup))
        return report
    if command != "patch":
        raise windows.FrontierWindowsError(f"Unknown native/cache operation: {command}")
    if state == "target":
        report["alreadyPatched"] = True
        return report
    # Derive the complete output before creating backups or changing either file.
    windows.build_blue_target(paths[0].read_bytes(), profile)
    backup_root, hashes = windows.backup_transaction_files(root, paths)
    expected_hashes = {relative: profile["source"]["sha256"] for relative in report["files"]}
    if hashes != expected_hashes:
        raise windows.FrontierWindowsError(f"Backup inputs changed; no files patched. Backup: {backup_root}")
    report.update(backup=str(backup_root), prePatchHashes=hashes)
    windows.write_json_atomic(backup_root / REPORT_NAME, report)
    # This preflight is outside rollback: we do not own concurrent changes to
    # inputs when this operation has not yet mutated either file.
    if inspect_pair(paths, profile) != "source" or index_path.read_bytes() != index_data:
        raise windows.FrontierWindowsError(f"Inputs changed after backup; no files patched. Backup: {backup_root}")
    modes = {target: stat.S_IMODE(target.stat().st_mode) for target in paths}
    try:
        for target in paths:
            windows.patch_blue_atomic(target, profile)
            target.chmod(modes[target])
        if inspect_pair(paths, profile) != "target" or index_path.read_bytes() != index_data:
            raise windows.FrontierWindowsError("Patched pair or original launcher index failed verification.")
        report.update(state="target", sha256=windows.sha256_file(paths[0]))
        windows.write_json_atomic(backup_root / REPORT_NAME, report)
        return report
    except Exception as error:
        try:
            windows.restore_transaction_files(root, backup_root, paths, hashes)
        except Exception as rollback_error:
            raise windows.FrontierWindowsError(
                f"Patch failed ({error}); rollback failed ({rollback_error}). Backup: {backup_root}"
            ) from error
        raise windows.FrontierWindowsError(
            f"Patch failed and both files were restored. Backup: {backup_root}. {error}"
        ) from error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "patch", "restore"))
    parser.add_argument("--client-root", required=True, type=Path)
    parser.add_argument("--build", required=True, type=int)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    if args.backup is not None and args.command != "restore":
        parser.error("--backup is only valid with restore")
    try:
        report = process_pair(args.command, args.client_root, args.build, args.profile, args.backup)
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    except (windows.FrontierWindowsError, OSError, ValueError, configparser.Error) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
