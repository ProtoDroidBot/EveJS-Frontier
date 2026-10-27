"""Export the build-3640684 voxel type catalog without loading native modules.

Read-only disassembly of the shipped generated loaders establishes the offsets
below. This exporter validates resource hashes and every root key before using
those build-specific layouts. It never executes client code or writes a client.
"""
from pathlib import Path
import argparse
import hashlib
import io
import json
import pickle
import struct

FILES = {
    "types": "3c/3cc5bf8ff5e9099a_917d04d6594426aa9a9efec2ffab311b",
    "components": "f2/f26def0295b69084_978c3aa04c4bca312f82340480293cc2",
    "groups": "b1/b198644fdc5397f3_642f6fbf758def36527ba178c327bf93",
    "localization": "2c/2c3038b3c38e91a1_3e11e958dc0e166681f2f635e9227dfb",
}
FINGERPRINTS = {
    "types": "8d7a099712d997ddc7b0f218c5c8a396",
    "components": "b00a1f82972b05f7c0ff27a06ba36e49",
}


def scalar(data, offset, format_string="<I"):
    return struct.unpack_from(format_string, data, offset)[0]


def read_sources(client_root):
    sources = {}
    for name, resource in FILES.items():
        raw = (client_root / "ResFiles" / resource).read_bytes()
        expected_md5 = resource.rsplit("_", 1)[1]
        if hashlib.md5(raw).hexdigest() != expected_md5:
            raise ValueError(f"Unexpected content for {name}: {resource}")
        if name in FINGERPRINTS and raw[:16].hex() != FINGERPRINTS[name]:
            raise ValueError(f"Unsupported {name} schema")
        sources[name] = raw
    return sources


def root_rows(raw, stride):
    if len(raw) < 56 or scalar(raw, 24, "<Q") != len(raw) - 32:
        raise ValueError("Invalid cFSD header length")
    body = raw[32:]
    root, count, bucket_count = struct.unpack_from("<3Q", body)
    pointers = struct.unpack_from(f"<{bucket_count}Q", body, root)
    rows = {}
    for bucket_index, pointer in enumerate(pointers):
        row_count = scalar(body, pointer - 8, "<Q")
        for index in range(row_count):
            offset = pointer + index * stride
            key = scalar(body, offset)
            if key % bucket_count != bucket_index or key in rows:
                raise ValueError(f"Invalid root key {key} for stride {stride}")
            rows[key] = offset
    if len(rows) != count:
        raise ValueError("Root row count differs from its header")
    return body, rows


class DataOnlyUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        raise ValueError(f"Localization cannot load global {module}.{name}")


def read_string(body, offset):
    pointer = scalar(body, offset, "<Q")
    length = scalar(body, pointer - 8, "<Q")
    if pointer + length > len(body):
        raise ValueError("cFSD string extends outside resource")
    return body[pointer:pointer + length].decode("utf-8")


def export_catalog(sources):
    localization = DataOnlyUnpickler(io.BytesIO(sources["localization"]), encoding="bytes").load()[1]
    types, type_rows = root_rows(sources["types"], 144)
    components, component_rows = root_rows(sources["components"], 1208)
    groups, group_rows = root_rows(sources["groups"], 32)
    output = []
    for type_id, offset in component_rows.items():
        value = offset + 8
        # spaceComponentsByTypeLoader: composite getter 0x18000d4e6;
        # regolith getter 0x18000eb28; scoop getter 0x18000d903.
        regolith = bool(scalar(components, value + 0x4A4) & (1 << 15))
        composite = bool(scalar(components, value + 0x4A0) & (1 << 14))
        scoop = bool(scalar(components, value + 0x4A4) & (1 << 19))
        if not (regolith or composite):
            continue
        record = type_rows[type_id]
        if scalar(types, record + 120) != type_id:
            raise ValueError("Type ID differs from its root key")
        group_id = scalar(types, record + 88)
        row = {
            "typeID": type_id, "name": localization[scalar(types, record + 124)][0],
            "groupID": group_id, "categoryID": scalar(groups, group_rows[group_id] + 4),
            "graphicID": scalar(types, record + 84), "mass": scalar(types, record + 24, "<d"),
            "radius": scalar(types, record + 48, "<d"), "volume": scalar(types, record + 64, "<d"),
            "regolithBlock": regolith, "compositeAsteroid": composite, "scoop": scoop,
        }
        if regolith:
            # regolithBlock is at value+0x40c; three float32 attributes.
            row["regolithScale"] = scalar(components, value + 0x414, "<f")
            row["driftDistance"] = scalar(components, value + 0x40C, "<f")
            row["driftSpeed"] = scalar(components, value + 0x410, "<f")
        if scoop:
            row["scoopAccessPolicy"] = read_string(components, value + 0x218)
        output.append(row)
    return {
        "clientBuild": 3640684,
        "sources": {name: {"resource": FILES[name], "sha256": hashlib.sha256(raw).hexdigest()}
                    for name, raw in sources.items()},
        "rowCounts": {"types": len(type_rows), "components": len(component_rows), "groups": len(group_rows)},
        "types": sorted(output, key=lambda row: row["typeID"]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = export_catalog(read_sources(args.client_root))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(result['types'])} verified voxel types to {args.output}")


if __name__ == "__main__":
    main()
