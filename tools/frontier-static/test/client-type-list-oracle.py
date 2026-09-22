"""Read-only parity probe for the installed Frontier evetypes bytecode.

Usage: python client-type-list-oracle.py <evetypes/__init__.pyc> <snapshot-dir>
The bytecode must use the same Python minor version as this interpreter.
"""

import hashlib
import importlib.util
import json
import marshal
import sys
import types
from pathlib import Path


def rows(root, name):
    with (root / name).open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def main():
    bytecode_path = Path(sys.argv[1])
    snapshot = Path(sys.argv[2])
    bytecode = bytecode_path.read_bytes()
    if bytecode[:4] != importlib.util.MAGIC_NUMBER:
        raise RuntimeError("Python bytecode version does not match this interpreter")
    module = marshal.loads(bytecode[16:])
    client_code = next(
        value for value in module.co_consts
        if isinstance(value, types.CodeType) and value.co_name == "GetTypeIDsFromTypeList"
    )

    lists = {row["_key"]: types.SimpleNamespace(**row) for row in rows(snapshot, "typeLists.jsonl")}
    groups = {row["_key"]: row["categoryID"] for row in rows(snapshot, "groups.jsonl")}
    all_types = rows(snapshot, "types.jsonl")
    by_category = {}
    by_group = {}
    by_tag = {}
    for row in all_types:
        type_id = row["_key"]
        group_id = row["groupID"]
        by_category.setdefault(groups[group_id], set()).add(type_id)
        by_group.setdefault(group_id, set()).add(type_id)
        for tag_id in row.get("tags", []):
            by_tag.setdefault(tag_id, set()).add(type_id)

    def union(mapping, keys):
        result = set()
        for key in keys:
            result.update(mapping.get(key, ()))
        return result

    class Loader:
        @staticmethod
        def GetData():
            return lists

    namespace = {
        "GetTypeIDsByCategories": lambda keys: union(by_category, keys),
        "GetTypeIDsByGroups": lambda keys: union(by_group, keys),
        "GetTypeIDsByTagIDs": lambda keys: union(by_tag, keys),
        "GetTypeIDsByTagID": lambda key: by_tag.get(key, set()),
        "TypeListLoader": Loader,
    }
    client_function = types.FunctionType(client_code, namespace, argdefs=(None, None))
    namespace["GetTypeIDsFromTypeList"] = client_function

    selected = [34, 36, 142, 231, 565, 609, 623, 629, 697, 784, 794, 795, 845, 846, 861, 923, 985]
    if len(sys.argv) > 3 and sys.argv[3] == "--all":
        selected = sorted(lists)
    probes = [84181, 78415, 84786, 85130, 81974, 82128, 77484]
    output = []
    for list_id in selected:
        members = client_function(lists[list_id], list_id, None)
        ordered = sorted(members)
        output.append({
            "listID": list_id,
            "count": len(ordered),
            "sha256": hashlib.sha256(",".join(map(str, ordered)).encode()).hexdigest(),
            "probes": {str(type_id): type_id in members for type_id in probes},
        })
    if len(sys.argv) > 3 and sys.argv[3] == "--all":
        digest_input = "|".join(f"{entry['listID']}:{entry['sha256']}" for entry in output)
        print(json.dumps({
            "listCount": len(output),
            "catalogSha256": hashlib.sha256(digest_input.encode()).hexdigest(),
        }, indent=2))
    else:
        print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
