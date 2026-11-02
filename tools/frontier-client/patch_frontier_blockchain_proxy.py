#!/usr/bin/env python3
"""Stage build 2455427's audited proxy host constant for the local Sui adapter.

This reads Python 2 marshal data as bytes. It neither imports client code nor
requires Python 2. Only one hash-identified string scalar is changed; bytecode,
ports and all other ZIP entries remain available exactly as before.
"""

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import tempfile
import zipfile
import zlib


BUILD = 2455427
MEMBER = "frontier/space_components/common/constants.pyj"
SOURCE_PACKED_SHA256 = "f717afb34d8626732d612c04394397b715a34988afd963e053c1f3253a864175"
SOURCE_PYC_SHA256 = "974d667125173bca76cadc5bdf80d38202238330eab13bdb5373d13fbd8eb28c"
SOURCE_HOST = b"proxy.devnet.dev-cluster.deusxvm.com"
LOCAL_HOST = b"127.0.0.1"
PORT = 32811


class PatchError(RuntimeError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def scalar(value):
    # This audited Python 2 marshal constant uses TYPE_STRING (s), followed
    # by its little-endian uint32 byte count, rather than an interned string.
    return b"s" + struct.pack("<I", len(value)) + value


def inspect_member(packed):
    try:
        raw = zlib.decompress(packed)
    except zlib.error as error:
        raise PatchError("The audited .pyj member is not a valid zlib payload") from error
    old, new = scalar(SOURCE_HOST), scalar(LOCAL_HOST)
    if digest(raw) == SOURCE_PYC_SHA256:
        if digest(packed) != SOURCE_PACKED_SHA256 or raw.count(old) != 1 or raw.count(new):
            raise PatchError("The source proxy constant does not match the exact build profile")
        return "source", raw
    if raw.count(old) == 0 and raw.count(new) == 1:
        restored = raw.replace(new, old, 1)
        if digest(restored) == SOURCE_PYC_SHA256:
            return "patched", raw
    raise PatchError("Unknown proxy member: no client data was changed")


def inspect_archive(path):
    with zipfile.ZipFile(path, "r") as archive:
        matches = [entry for entry in archive.infolist() if entry.filename == MEMBER]
        if len(matches) != 1:
            raise PatchError("The exact proxy module must occur once in the archive")
        state, raw = inspect_member(archive.read(matches[0]))
        return state, raw


def preserve_backup(path):
    backup = path.with_name(path.name + ".before-evm-sui-proxy.bak")
    if backup.exists():
        if file_digest(backup) != file_digest(path):
            raise PatchError("The existing backup differs; preserve it before choosing another output path")
        return backup
    with path.open("rb") as source, backup.open("xb") as target:
        shutil.copyfileobj(source, target, length=1024 * 1024)
        target.flush()
        os.fsync(target.fileno())
    shutil.copystat(path, backup)
    return backup


def patch_archive(source, output, in_place=False):
    state, raw = inspect_archive(source)
    if source == output and not in_place:
        raise PatchError("Use --in-place explicitly when source and output are the same file")
    if state == "patched" and source == output:
        return {"state": "patched", "changed": False, "archive": str(output)}
    patched_raw = raw if state == "patched" else raw.replace(scalar(SOURCE_HOST), scalar(LOCAL_HOST), 1)
    patched_packed = zlib.compress(patched_raw)
    # Reverse reconstruction is a complete-source hash check, including all
    # original code bytes and constants. A marker match alone is insufficient.
    if digest(patched_raw.replace(scalar(LOCAL_HOST), scalar(SOURCE_HOST), 1)) != SOURCE_PYC_SHA256:
        raise PatchError("The changed marshal scalar cannot reconstruct the audited source")
    output.parent.mkdir(parents=True, exist_ok=True)
    backup = preserve_backup(output) if output.exists() else None
    source_hash = file_digest(source)
    descriptor, temporary = tempfile.mkstemp(prefix=output.name + ".proxy-", suffix=".tmp", dir=output.parent)
    os.close(descriptor)
    temporary_path = Path(temporary)
    try:
        with zipfile.ZipFile(source, "r") as original, zipfile.ZipFile(temporary_path, "w") as staged:
            staged.comment = original.comment
            for entry in original.infolist():
                data = patched_packed if entry.filename == MEMBER else original.read(entry)
                staged.writestr(copy.copy(entry), data)
        with zipfile.ZipFile(temporary_path, "r") as staged:
            if staged.testzip() is not None:
                raise PatchError("The staged archive failed its CRC check")
        if inspect_archive(temporary_path)[0] != "patched":
            raise PatchError("The staged proxy module did not retain the exact patch")
        if file_digest(source) != source_hash:
            raise PatchError("The source archive changed while it was being staged")
        with temporary_path.open("r+b") as handle:
            os.fsync(handle.fileno())
        shutil.copymode(source, temporary_path)
        os.replace(temporary_path, output)
    finally:
        temporary_path.unlink(missing_ok=True)
    report = {
        "format": "evejs-frontier-legacy-proxy-stage-v1",
        "build": BUILD,
        "state": "patched",
        "changed": True,
        "source": str(source),
        "archive": str(output),
        "sourceArchiveSHA256": source_hash,
        "archiveSHA256": file_digest(output),
        "sourceMemberSHA256": SOURCE_PYC_SHA256,
        "patchedMemberSHA256": digest(patched_raw),
        "host": LOCAL_HOST.decode("ascii"),
        "port": PORT,
        "backup": str(backup) if backup else None,
    }
    report_path = output.with_name(output.name + ".evm-sui-proxy.json")
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path, help="Explicit source code.ccp path")
    parser.add_argument("--build", required=True, type=int, choices=[BUILD])
    destination = parser.add_mutually_exclusive_group()
    destination.add_argument("--output", type=Path, help="Dedicated staged code.ccp destination")
    destination.add_argument("--in-place", action="store_true", help="Patch the explicit source, preserving a backup")
    parser.add_argument("--check", action="store_true", help="Inspect the audited member without writing")
    args = parser.parse_args()
    source = args.archive.expanduser().resolve()
    ini = source.parent / "start.ini"
    if ini.is_file():
        build = re.search(r"^build\s*=\s*(\d+)\s*$", ini.read_text(encoding="utf-8", errors="replace"), re.MULTILINE | re.IGNORECASE)
        if not build or int(build.group(1)) != BUILD:
            raise PatchError("The installation start.ini is not build 2455427")
    if args.check:
        state, _raw = inspect_archive(source)
        print(json.dumps({"build": BUILD, "state": state, "changed": False, "archive": str(source)}))
        return
    if not args.output and not args.in_place:
        parser.error("Choose --output for a staged copy, or explicitly select --in-place")
    output = args.output.expanduser().resolve() if args.output else source
    print(json.dumps(patch_archive(source, output, args.in_place), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (PatchError, OSError, zipfile.BadZipFile) as error:
        raise SystemExit("Legacy proxy staging failed: " + str(error))
