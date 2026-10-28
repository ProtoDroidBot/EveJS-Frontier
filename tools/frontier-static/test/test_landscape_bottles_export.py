import argparse
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("landscape_bottles", Path(__file__).resolve().parents[1] / "export-landscape-bottles.py")
EXPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORT)


class BottlesExportTests(unittest.TestCase):
    def inputs(self, root, *, probe=False):
        args = argparse.Namespace(python_runtime=root / "Python $(keep) '3.12'",
            client_root=root / "client with spaces", output=root / "decoded",
            runner=root / "runner" / "bin" / "wine", flatpak_app="com.usebottles.bottles",
            flatpak_bin="flatpak", probe=probe, timeout=30)
        for path in (args.python_runtime / "python.exe", args.python_runtime / "python312.dll",
                     args.python_runtime / "python312.zip", args.client_root / "stillness" / "start.ini",
                     args.client_root / "stillness" / "code.ccp", args.runner, args.runner.with_name("wineserver")):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"fixture")
        (args.client_root / "stillness" / "bin64").mkdir()
        args.runner.chmod(0o755)
        return args

    def test_argv_preserves_paths_and_prefix_is_always_owned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.inputs(root)
            calls = []
            def invoke(command, **kwargs):
                calls.append(command)
                prefix = next(item.split("=", 1)[1] for item in command if item.startswith("WINEPREFIX="))
                self.assertTrue(Path(prefix).parent.is_dir())
                return subprocess.CompletedProcess(command, 0)
            with patch.object(EXPORT.subprocess, "run", side_effect=invoke), patch.dict("os.environ", {"WINEPREFIX": "/do/not/touch/real-bottle"}):
                self.assertEqual(EXPORT.run(args), 0)
            command = calls[0]
            self.assertIn(str(args.python_runtime / "python.exe"), command)
            self.assertIn("--filesystem=" + str(args.client_root) + ":ro", command)
            self.assertIn(EXPORT.windows_path(args.client_root), command)
            self.assertNotIn("sh", command)
            self.assertNotIn("-c", command)
            prefixes = {item for cmd in calls for item in cmd if item.startswith("WINEPREFIX=")}
            self.assertEqual(len(prefixes), 1)
            prefix = Path(next(iter(prefixes)).split("=", 1)[1])
            self.assertNotEqual(prefix, Path("/do/not/touch/real-bottle"))
            self.assertFalse(prefix.parent.exists())
            self.assertEqual([cmd[-1] for cmd in calls[1:]], ["-k", "-w"])

    def test_failure_and_timeout_both_stop_only_owned_worker(self):
        for outcome in (7, subprocess.TimeoutExpired("worker", 30)):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as directory:
                args = self.inputs(Path(directory))
                calls = []
                def invoke(command, **kwargs):
                    calls.append(command)
                    if len(calls) == 1:
                        if isinstance(outcome, Exception):
                            raise outcome
                        return subprocess.CompletedProcess(command, outcome)
                    return subprocess.CompletedProcess(command, 0)
                with patch.object(EXPORT.subprocess, "run", side_effect=invoke):
                    if isinstance(outcome, Exception):
                        with self.assertRaises(subprocess.TimeoutExpired):
                            EXPORT.run(args)
                    else:
                        self.assertEqual(EXPORT.run(args), 7)
                self.assertEqual([cmd[-1] for cmd in calls[1:]], ["-k", "-w"])

    def test_output_cannot_grant_write_access_to_client_runtime_or_runner(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self.inputs(root)
            for output in (args.client_root / "decoded", args.python_runtime / "decoded",
                           args.runner.parent / "decoded", root):
                with self.subTest(output=output):
                    args.output = output
                    with self.assertRaisesRegex(ValueError, "must not overlap"):
                        EXPORT.validate_paths(args)

    def test_probe_never_creates_or_mounts_output(self):
        with tempfile.TemporaryDirectory() as directory:
            args = self.inputs(Path(directory), probe=True)
            with patch.object(EXPORT.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as invoke:
                self.assertEqual(EXPORT.run(args), 0)
            self.assertFalse(args.output.exists())
            self.assertNotIn("--filesystem=" + str(args.output), invoke.call_args_list[0].args[0])
            self.assertNotIn("--client-root", invoke.call_args_list[0].args[0])


if __name__ == "__main__":
    unittest.main()
