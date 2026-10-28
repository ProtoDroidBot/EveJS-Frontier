"""Extract 3640684 progression literals and verified type metadata, without executing client code."""
import argparse
import dis
import hashlib
import importlib.util
import io
import json
import marshal
from pathlib import Path
import zipfile


def skill_literals(code):
    """Interpret only the literal registration expression; reject other opcodes."""
    stack, result, keywords = [], [], ()
    active = False
    fields = {"Skill": ("skill_id", "key", "name", "complexity_attribute_id", "effect_id", "effects"),
              "SkillEffect": ("key", "attribute_id", "scale", "bonus_attribute_id")}
    for op in dis.get_instructions(code):
        if op.offset == 202:
            active = True
        if not active:
            continue
        if op.opname in ("PUSH_NULL", "RETURN_CONST"):
            continue
        if op.opname == "LOAD_NAME":
            if op.argval not in (*fields, "register_skill"):
                raise ValueError(op)
            stack.append(op.argval)
        elif op.opname == "LOAD_CONST":
            stack.append(op.argval)
        elif op.opname == "BUILD_TUPLE":
            values = stack[-op.arg:]; del stack[-op.arg:]; stack.append(values)
        elif op.opname == "KW_NAMES":
            keywords = code.co_consts[op.arg]
        elif op.opname == "CALL":
            values = stack[-op.arg:]; del stack[-op.arg:]
            fn = stack.pop()
            if fn == "register_skill":
                result.append(values[0]); stack.append(values[0])
            else:
                positional = len(values) - len(keywords)
                stack.append(dict(zip(fields[fn][:positional] + keywords, values)))
            keywords = ()
        elif op.opname == "STORE_NAME":
            stack.pop()
        else:
            raise ValueError(op)
    if len(result) != 9:
        raise ValueError("Unexpected Frontier skill catalog")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("voxel_export", Path(__file__).with_name("export-voxel-catalog.py"))
    reader = importlib.util.module_from_spec(spec); spec.loader.exec_module(reader)
    source = reader.read_sources(args.client_root)
    types, rows = reader.root_rows(source["types"], 144)
    groups, group_rows = reader.root_rows(source["groups"], 32)
    localization = reader.DataOnlyUnpickler(io.BytesIO(source["localization"]), encoding="bytes").load()[1]
    output = []
    for type_id, offset in rows.items():
        group = reader.scalar(types, offset + 88)
        category = reader.scalar(groups, group_rows[group] + 4)
        if group not in (5076, 5105) and category != 2153 and type_id not in (95339, 95340, 95341, 96035):
            continue
        output.append({"typeID": type_id, "groupID": group, "categoryID": category,
                       "name": localization.get(reader.scalar(types, offset + 124), (str(type_id),))[0]})
    archive = args.client_root / "stillness/code.ccp"
    with zipfile.ZipFile(archive) as z:
        skills = skill_literals(marshal.loads(z.read("frontier/skills/common/skills.pyc")[16:]))
    result = {"clientBuild": 3640684, "codeSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
              "sources": {k: {"resource": reader.FILES[k], "sha256": hashlib.sha256(v).hexdigest()} for k,v in source.items()},
              "skills": skills, "types": sorted(output, key=lambda t: t["typeID"]),
              "constants": {"conversionRate": 1.5e-7, "complexityH": 19, "complexityReference": 100,
                            "crownInjectLimit": 6, "crownCreationDelaySeconds": 1800,
                            "medicalKitTypeID": 95339, "medicalKitTraitsHealed": 100,
                            "remedyTypeIDs": {"heat": 95340, "feralization": 95341, "temporal_drift": 96035}}}
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
