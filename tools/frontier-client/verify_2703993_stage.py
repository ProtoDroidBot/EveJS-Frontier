#!/usr/bin/env python3
"""Verify an existing, isolated 2703993 stage without launching or trusting Wine.

The optional idempotence check calls the shared patch API only after a complete
stage passes verification, then requires every protected file and backup to
remain identical. Resource hashes are sampled by default; --verify-cache-hashes
checks every unique indexed cache object against its packaged MD5.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import nullcontext
import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile

import frontier_windows_client as core

BUILD = 2703993
CHANGED_MEMBER = "frontier/beta.pyc"
DOCKING_MEMBER = "menucheckers/celestialCheckers.pyc"
SOURCE_HASHES = {
    "code.ccp": "c31d2d4ba8edbd1e15297623dbb6856b6f515376e20b2286da98c20ecda271a9",
    "bin64/blue.pyd": "bbb482acbd968513107b3755e08e8bb54796d1d498e62034c64e841a17f1aa81",
    "resfileindex.txt": "7206e372c7c34a4323672a24bb4ab76c81b99158c3e995d821d941aebace2aaf",
    "bin64/exefile.exe": "bbd02dc90c037217a3dacb42d2454c3e21d40baa06cb4e2efb6399172830835b",
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest_file(path: Path, algorithm="sha256") -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compare_archives(source: Path, staged: Path) -> dict:
    """Compare each ZIP occurrence, including duplicate names and entry order."""
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(staged) as patched:
        old, new = original.infolist(), patched.infolist()
        names = [entry.filename for entry in old]
        require(names == [entry.filename for entry in new], "ZIP entry identities, duplicates or ordering changed.")
        require(original.comment == patched.comment, "ZIP archive comment changed.")
        changed = []
        metadata_fields = ("date_time", "compress_type", "comment", "extra", "internal_attr", "external_attr", "create_system")
        for index, (left, right) in enumerate(zip(old, new)):
            require(all(getattr(left, field) == getattr(right, field) for field in metadata_fields),
                    f"ZIP entry metadata changed at occurrence {index}: {left.filename}")
            if original.read(left) != patched.read(right):
                changed.append({"entry": index, "name": left.filename})
        require(len(changed) == 1 and changed[0]["name"] == CHANGED_MEMBER,
                f"Unexpected ZIP content changes: {changed}")
        counts = Counter(names)
        require(counts[CHANGED_MEMBER] == 1, "Expected exactly one Frontier feature module.")
        require(counts[DOCKING_MEMBER] == 1, "Expected exactly one native docking module.")
        return {"entries": len(names), "uniqueNames": len(counts),
                "duplicateNames": {name: count for name, count in sorted(counts.items()) if count > 1},
                "changedEntries": changed, "unchangedEntries": len(names) - len(changed),
                "nativeDockingUnchanged": True, "entryOrderPreserved": True,
                "entryMetadataPreserved": True, "archiveCommentPreserved": True}


def cache_copy_report(stage: Path, marker: dict, *, verify_all=False) -> dict:
    require(marker.get("resFiles", {}).get("mode") == "copy", "Acceptance requires a copied cache, not a shared cache link.")
    paths = core.stage_paths(stage, marker)
    checked = core.verify_resfiles(stage, marker, paths)
    cache = paths["resFiles"]
    original_cache = core.discover_official_resfiles(Path(marker["sourceRoot"]))
    copied_files = 0
    for directory, _, filenames in os.walk(cache, followlinks=False):
        for name in filenames:
            target = Path(directory) / name
            require(target.stat().st_nlink == 1, f"Copied cache contains a hard link: {target.relative_to(cache)}")
            original = original_cache / target.relative_to(cache)
            require(not original.exists() or not os.path.samefile(target, original),
                    f"Copied cache aliases the original: {target.relative_to(cache)}")
            copied_files += 1
    indexed = {}
    for line in paths["resIndex"].read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        logical, relative, md5, size, _ = line.strip().split(",")
        previous = indexed.get(relative)
        require(previous is None or (previous["md5"], previous["bytes"]) == (md5.lower(), int(size)),
                f"Conflicting resource-cache attestations: {relative}")
        indexed[relative] = {"path": relative, "logicalPath": logical, "md5": md5.lower(), "bytes": int(size),
                             "staticData": logical.startswith("res:/staticdata/") or bool(previous and previous["staticData"])}
    ordered = sorted(indexed)
    if verify_all:
        selected = ordered
    else:
        sample_count = min(16, len(ordered))
        sample = {ordered[index * (len(ordered) - 1) // max(1, sample_count - 1)] for index in range(sample_count)}
        selected = sorted({relative for relative, row in indexed.items() if row["staticData"]} | sample)
    for relative in selected:
        require(digest_file(core.safe_relative_path(cache, relative), "md5") == indexed[relative]["md5"],
                f"Copied resource MD5 mismatch: {relative}")
    return {**checked, "copyFiles": copied_files, "noHardLinks": True,
            "hashScope": "all unique indexed objects" if verify_all else "all indexed static data plus up to 16 evenly spaced cache objects",
            "hashObjects": len(selected), "hashBytes": sum(indexed[relative]["bytes"] for relative in selected),
            "allIndexedHashesVerified": verify_all,
            "hashes": [{"path": relative, "md5": indexed[relative]["md5"]} for relative in selected]}


def protected_fingerprints(stage: Path, marker: dict) -> dict:
    paths = core.stage_paths(stage, marker)
    files = {path for path in core.transaction_paths(paths)}
    files.update(paths[key] for key in ("exefile", "startIni", "commonIni", "resIndex"))
    return {path.relative_to(stage).as_posix(): digest_file(path) for path in sorted(files)}


def backup_fingerprints(stage: Path) -> dict:
    root = core.checked_backup_base(stage, require_exists=True)
    results = {}
    for directory, directories, filenames in os.walk(root, followlinks=False):
        for name in (*directories, *filenames):
            candidate = Path(directory) / name
            require(not core.is_reparse_point(candidate), "Backup tree contains a redirected path.")
        for name in filenames:
            file = Path(directory) / name
            results[file.relative_to(root).as_posix()] = digest_file(file)
    return results


def verify_stage(stage: Path, *, node: Path, ca=core.DEFAULT_CA, xmpp_leaf=core.DEFAULT_XMPP_LEAF,
                 gateway_leaf=core.DEFAULT_GATEWAY_LEAF, verify_cache_hashes=False, check_idempotence=False) -> dict:
    require(sys.version_info[:2] == (3, 12), "Native CPython 3.12 exactly is required.")
    stage = Path(os.path.abspath(stage))
    for ancestor in (stage, *stage.parents):
        if os.path.lexists(ancestor):
            require(not core.is_reparse_point(ancestor), f"Stage path traverses a redirected ancestor: {ancestor}")
    lock = nullcontext()
    if sys.platform == "linux":
        import frontier_linux_client as linux
        lock = linux.stage_lock(stage, create=False)
    with lock:
        if sys.platform == "linux":
            marker = linux.load_owned_stage(stage, BUILD)
            if check_idempotence:
                linux.assert_not_running(stage)
        else:
            _, marker = core.load_stage(stage)
        require(marker.get("build") == BUILD, "Acceptance is only registered for exact build 2703993.")
        require(not marker.get("sourceSync"), "Acceptance requires an isolated stage without retail synchronization.")
        source = Path(marker["sourceRoot"])
        require(not core.is_within(stage, source) and not core.is_within(source, stage), "Stage overlaps its source installation.")
        source_before = core.verify_retail_unchanged(marker, stage)
        for relative, expected in SOURCE_HASHES.items():
            require(digest_file(source / relative) == expected, f"Source fingerprint does not match exact build 2703993: {relative}")
        options = {"node_path": node, "ca_path": ca, "xmpp_leaf": xmpp_leaf, "gateway_leaf": gateway_leaf}
        report = core.check_stage(stage, **options)
        require(report.get("codeStates") == {"docking": "native", "features": "patched"}, "Unexpected exact-build native docking/feature state.")
        require(digest_file(stage / "bin64/exefile.exe") == SOURCE_HASHES["bin64/exefile.exe"], "Staged executable changed.")
        archive = compare_archives(source / "code.ccp", stage / "code.ccp")
        cache = cache_copy_report(stage, marker, verify_all=verify_cache_hashes)
        fingerprints = protected_fingerprints(stage, marker)
        backups = backup_fingerprints(stage)
        if check_idempotence:
            core.patch_stage(stage, **options)
            require(protected_fingerprints(stage, marker) == fingerprints, "Idempotent patch changed a protected file or marker.")
            require(backup_fingerprints(stage) == backups, "Idempotent patch changed patch backups.")
        require(core.verify_retail_unchanged(marker, stage) == source_before, "Official source changed during acceptance checks.")
        return {"format": "evejs-frontier-stage-acceptance-v1", "build": BUILD,
                "verifiedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "sourceRoot": str(source), "stage": str(stage), "valid": True,
                "sourceProtectedFilesUnchanged": True, "sourceFingerprints": source_before,
                "stageFingerprints": fingerprints, "zip": archive, "resFiles": cache,
                "codeStates": report["codeStates"], "nativeBlueState": report["blueState"],
                "certificateChainsValid": report["certificateChainsValid"],
                "caFingerprintSha256": report["caFingerprintSha256"],
                "backupFiles": len(backups), "backupFingerprints": backups,
                "idempotenceChecked": check_idempotence,
                "runtimeTrust": "not probed; launch requires selected-prefix Authenticode and ROOT checks",
                "liveGameplayValidated": False}


def parser():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--staged-root", type=Path, required=True)
    cli.add_argument("--node", type=Path, required=True)
    cli.add_argument("--ca", type=Path, default=core.DEFAULT_CA)
    cli.add_argument("--xmpp-leaf", type=Path, default=core.DEFAULT_XMPP_LEAF)
    cli.add_argument("--gateway-leaf", type=Path, default=core.DEFAULT_GATEWAY_LEAF)
    cli.add_argument("--verify-cache-hashes", action="store_true")
    cli.add_argument("--check-idempotence", action="store_true")
    cli.add_argument("--report", type=Path)
    return cli


def main():
    args = parser().parse_args()
    if args.report:
        _, marker = core.load_stage(args.staged_root)
        for protected in (args.staged_root.resolve(), Path(marker["sourceRoot"]).resolve()):
            require(not core.is_within(args.report.resolve(), protected), "Write the acceptance report outside the stage and source.")
    report = verify_stage(args.staged_root, node=args.node, ca=args.ca, xmpp_leaf=args.xmpp_leaf,
                          gateway_leaf=args.gateway_leaf, verify_cache_hashes=args.verify_cache_hashes,
                          check_idempotence=args.check_idempotence)
    payload = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(payload, encoding="utf-8")
        print(json.dumps({"valid": True, "build": BUILD, "report": str(args.report),
                          "zipChangedEntries": report["zip"]["changedEntries"],
                          "cacheHashObjects": report["resFiles"]["hashObjects"],
                          "allIndexedHashesVerified": report["resFiles"]["allIndexedHashesVerified"],
                          "idempotenceChecked": report["idempotenceChecked"]}))
    else:
        print(payload, end="")


if __name__ == "__main__":
    main()
