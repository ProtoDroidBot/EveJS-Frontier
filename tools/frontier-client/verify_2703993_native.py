#!/usr/bin/env python3
"""Verify the 2703993 native profile using disposable copies of exact inputs.

No installed files are patched. This offline check does not establish
Authenticode trust, prefix trust, full client staging, or gameplay acceptance.
The existing Windows/Wine trust checks remain required before launch.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import tempfile

import frontier_windows_client as windows
import patch_frontier_blue_cache as cache_patch


BUILD = 2703993
HERE = Path(__file__).resolve().parent
EVIDENCE = HERE / "evidence/blue-pyd.2703993.json"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise windows.FrontierWindowsError(message)


def pe_sections(data: bytes) -> tuple[list[dict], int]:
    windows.parse_pe_layout(data)
    pe = windows.read_u32(data, 0x3C)
    optional = pe + 24
    optional_size = windows.read_u16(data, pe + 20)
    sections = []
    for index in range(windows.read_u16(data, pe + 6)):
        entry = optional + optional_size + index * 40
        virtual_size, rva, raw_size, raw_offset = struct.unpack_from("<IIII", data, entry + 8)
        sections.append({"rva": rva, "rawOffset": raw_offset, "rawSize": raw_size,
                         "virtualSize": virtual_size})
    return sections, optional


def inspect_control_flow(data: bytes, profile: dict) -> dict:
    """Recheck recorded instructions, references and PE exception bounds."""
    require(windows.inspect_blue_bytes(data, profile) == "source", "Native input is not the exact 2703993 source.")
    evidence = windows.read_json(EVIDENCE)
    sections, optional = pe_sections(data)

    def offset(rva: int) -> int:
        for section in sections:
            relative = rva - section["rva"]
            if 0 <= relative < section["rawSize"]:
                return section["rawOffset"] + relative
        raise windows.FrontierWindowsError(f"Evidence RVA is outside file-backed PE sections: 0x{rva:x}")

    for record in evidence["instructions"]:
        location = offset(int(record["rvaHex"], 16))
        expected = bytes.fromhex(record["bytesHex"])
        require(data[location:location + len(expected)] == expected,
                f"Instruction evidence differs at {record['rvaHex']}.")
        if "relativeTargetRvaHex" in record:
            displacement_offset = record["displacementOffset"]
            displacement = struct.unpack_from("<i", data, location + displacement_offset)[0]
            target = int(record["rvaHex"], 16) + len(expected) + displacement
            require(target == int(record["relativeTargetRvaHex"], 16), "Relative instruction target differs.")

    exception_rva, exception_size = struct.unpack_from("<II", data, optional + 112 + 3 * 8)
    exception_offset = offset(exception_rva)
    bounds = {struct.unpack_from("<III", data, position)[:2]
              for position in range(exception_offset, exception_offset + exception_size, 12)}
    for function in evidence["functions"]:
        start, end = int(function["startRvaHex"], 16), int(function["endRvaHex"], 16)
        require((start, end) in bounds, f"PE exception bounds differ for {function['name']}.")
        content = data[offset(start):offset(start) + end - start]
        require(hashlib.sha256(content).hexdigest() == function["sha256"], "Recorded function hash differs.")

    sequence = bytes.fromhex(profile["verifierEvidence"]["uniquePatchedInstructionSequence"])
    require(data.count(sequence) == 1, "Verifier normalization sequence is not unique.")
    require(data.index(sequence) == profile["patches"][0]["fileOffset"], "Profile patch does not select the recorded sequence.")
    failure = evidence["invalidSignatureString"]
    start = offset(int(failure["rvaHex"], 16))
    require(data[start:start + len(failure["text"]) + 1] == failure["text"].encode("ascii") + b"\0",
            "Manifest failure string differs.")
    return {"instructionReferencesVerified": len(evidence["instructions"]),
            "functionBoundsAndHashesVerified": len(evidence["functions"]),
            "negativeErrorPathPreserved": True}


def verify(client_root: Path) -> dict:
    client_root = client_root.resolve()
    _, profile = windows.resolve_profile(BUILD, "blue.pyd")
    blue = client_root / "bin64/blue.pyd"
    index = client_root.parent / f"index_{client_root.name}.txt"
    cache = client_root.parent / "ResFiles" / profile["resourceCache"]["cachePath"]
    originals = [blue, cache, index, client_root / "start.ini", client_root / "manifest.dat"]
    before = {str(file): windows.sha256_file(file) for file in originals}
    source = blue.read_bytes()
    control_flow = inspect_control_flow(source, profile)
    require(cache.read_bytes() == source, "The supplied native/cache source pair differs.")
    require(hashlib.md5(source).hexdigest() == profile["resourceCache"]["sourceMd5"], "Source cache MD5 differs.")
    require(windows.manifest_hashes_match(client_root / "manifest.dat", client_root, profile),
            "The source manifest's selected native/code/certificate/executable digests do not match.")

    with tempfile.TemporaryDirectory(prefix="evejs-2703993-native-copy-") as temporary:
        root = Path(temporary)
        copied_client = root / client_root.name
        copied_blue = copied_client / "bin64/blue.pyd"
        copied_cache = root / "ResFiles" / profile["resourceCache"]["cachePath"]
        for source_path, destination in [(blue, copied_blue), (cache, copied_cache),
                                         (index, root / index.name),
                                         (client_root / "start.ini", copied_client / "start.ini"),
                                         (client_root / "manifest.dat", copied_client / "manifest.dat")]:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, destination)

        check = cache_patch.process_pair("check", copied_client, BUILD)
        require(check["state"] == "source", "Copied source failed native/cache check.")
        patched = cache_patch.process_pair("patch", copied_client, BUILD)
        require(patched["state"] == "target", "Copied pair failed to patch.")
        require(cache_patch.process_pair("check", copied_client, BUILD)["state"] == "target", "Patched pair check failed.")
        require(cache_patch.process_pair("patch", copied_client, BUILD).get("alreadyPatched") is True, "Patch is not idempotent.")
        target = copied_blue.read_bytes()
        require(target == copied_cache.read_bytes(), "Patched native/cache copies differ.")
        layout = windows.parse_pe_layout(target)
        require(layout["securityFileOffset"] == layout["securitySize"] == 0, "Mutated copy retained an invalid Authenticode overlay.")

        # A target instruction combined with the old certificate/checksum is a
        # partial patch; neither it nor unrelated source changes can be accepted.
        patch = profile["patches"][0]
        partial = bytearray(source)
        partial[patch["fileOffset"]:patch["fileOffset"] + 3] = bytes.fromhex(patch["afterHex"])
        require(windows.inspect_blue_bytes(bytes(partial), profile) == "partial", "Partial patch was accepted.")
        for candidate in (source, target):
            altered = bytearray(candidate)
            altered[0x500] ^= 1
            require(windows.inspect_blue_bytes(bytes(altered), profile) not in {"source", "target"}, "Tampered copy was accepted.")
            try:
                windows.build_blue_target(bytes(altered), profile)
            except windows.FrontierWindowsError:
                pass
            else:
                raise windows.FrontierWindowsError("Tampered copy was eligible for patching.")

        restored = cache_patch.process_pair("restore", copied_client, BUILD, backup=Path(patched["backup"]))
        require(restored["state"] == "source", "Copied pair did not restore.")
        require(copied_blue.read_bytes() == copied_cache.read_bytes() == source, "Restored bytes differ from exact source.")
        require((root / index.name).read_bytes() == index.read_bytes(), "Copied launcher index changed.")
        require((copied_client / "manifest.dat").read_bytes() == (client_root / "manifest.dat").read_bytes(), "Copied manifest changed.")

    after = {str(file): windows.sha256_file(file) for file in originals}
    require(before == after, "Installed source input changed during verification.")
    return {"format": "evejs-frontier-native-profile-verification-v1", "build": BUILD,
            "sourceSha256": profile["source"]["sha256"], "targetSha256": profile["target"]["sha256"],
            "controlFlow": control_flow, "copiedPairPatchCheckRestore": True,
            "idempotent": True, "tamperedSourceAndTargetRejected": True, "partialPatchRejected": True,
            "sourceInputsUnchanged": True, "sourceManifestTargetsMatch": True,
            "sourceAuthenticodeTrustValidated": False,
            "fullClientStageValidated": False, "nativeLaunchValidated": False,
            "scope": "Offline exact-build PE and launcher-cache copies; Windows/Wine trust and gameplay remain untested."}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-root", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    arguments = parser.parse_args()
    report = verify(arguments.client_root)
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    arguments.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
