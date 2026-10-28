import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("landscape_export", Path(__file__).resolve().parents[1] / "export-landscape-native.py")
EXPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORT)


class NativeExportTests(unittest.TestCase):
    def test_normalization_preserves_mapping_keys_vectors_and_optional_fields(self):
        class Native:
            __module__ = "landscapeLoader"
            sites = {900000001: {"position": (1.25, -2.5, 3.0), "ecosystemID": 2}}
            optional = None
        self.assertEqual(EXPORT.normalize(Native()), {"sites": {"900000001": {"position": [1.25, -2.5, 3.0], "ecosystemID": 2}}, "optional": None})

    def test_unreadable_fields_nonfinite_numbers_and_key_collisions_fail_closed(self):
        class Broken:
            @property
            def position(self):
                raise ValueError("invalid native pointer")
        with self.assertRaisesRegex(ValueError, "invalid native pointer"):
            EXPORT.normalize(Broken())
        with self.assertRaisesRegex(ValueError, "Nonfinite"):
            EXPORT.normalize([float("nan")])
        with self.assertRaisesRegex(ValueError, "collision"):
            EXPORT.normalize({1: "integer", "1": "text"})

    def test_type_reference_detection_excludes_domain_enums(self):
        self.assertEqual(EXPORT.referenced_type_ids({"archetypeID": 27, "eventTypeID": 32, "triggerTypeID": 1,
            "entryTypeID": 91308, "rooms": [{"typeID": 95899}], "entryPattern": {"baseCloudTypeID": 92419, "postProcessTypeID": 95427}}), {91308, 95899, 92419, 95427})

    def test_resource_verification_rejects_content_and_schema_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / "ResFiles").mkdir()
            resource = root / "ResFiles" / "data"
            payload = bytes.fromhex("11" * 16) + bytes(8) + struct.pack("<QQQQ", 24, 24, 0, 0)
            resource.write_bytes(payload)
            index = {"res:/staticdata/test.fsdbinary": ["res:/staticdata/test.fsdbinary", "data", EXPORT.digest(resource, "md5"), str(len(payload))]}
            _, metadata = EXPORT.verify_resource(root, index, "res:/staticdata/test.fsdbinary", "11" * 16)
            self.assertEqual(metadata["declaredRootRows"], 0)
            with self.assertRaisesRegex(ValueError, "schema"):
                EXPORT.verify_resource(root, index, "res:/staticdata/test.fsdbinary", "22" * 16)
            resource.write_bytes(bytes([2]) + payload[1:])
            with self.assertRaisesRegex(ValueError, "hash"):
                EXPORT.verify_resource(root, index, "res:/staticdata/test.fsdbinary")

    def test_partial_output_never_replaces_previous_complete_table(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "landscape.jsonl"
            EXPORT.write_rows(path, [{"_key": 1}])
            prior = path.read_bytes()
            def broken():
                yield {"_key": 2}
                raise ValueError("decode failure")
            with self.assertRaisesRegex(ValueError, "decode failure"):
                EXPORT.write_rows(path, broken())
            self.assertEqual(path.read_bytes(), prior)
            self.assertFalse(path.with_name(path.name + ".tmp").exists())

    def test_localization_cannot_execute_pickle_globals(self):
        with self.assertRaisesRegex(ValueError, "cannot load global"):
            EXPORT.DataOnlyUnpickler(io.BytesIO(b"cos\nsystem\n.")).load()


if __name__ == "__main__":
    unittest.main()
