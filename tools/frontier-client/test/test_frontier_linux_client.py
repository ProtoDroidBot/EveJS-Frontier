from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

if sys.platform != "linux":
    raise unittest.SkipTest("Linux Wine host orchestration requires /proc and fcntl.")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import frontier_linux_client as linux
import frontier_windows_client as core
import frontier_wine_trust_probe as probe
from test_frontier_windows_client import make_pe_source, make_profile, pem


class LinuxClientTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="frontier linux paths with spaces ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.build = 3640684
        self.source = self.root / "retail" / "stillness"
        self.cache = self.source.parent / "ResFiles"
        self.base = self.root / "staged client"
        self.stage = self.base / str(self.build)
        (self.source / "bin64/packages/certifi").mkdir(parents=True)
        (self.cache / "aa").mkdir(parents=True)
        (self.cache / "aa/aabbcc").write_bytes(b"abc")
        (self.source / "start.ini").write_text(f"[main]\nappname=FRONTIER\nbuild={self.build}\n")
        (self.source / "resfileindex.txt").write_text("res:/fixture,aa/aabbcc,0123456789abcdef0123456789abcdef,3,2\n")
        self.blue = make_pe_source()
        self.profile = make_profile(self.blue)
        self.profile["build"] = self.build
        (self.source / "bin64/blue.pyd").write_bytes(self.blue)
        for name in ("code.ccp", "manifest.dat", "bin64/exefile.exe", "bin64/cacert.pem", "bin64/packages/certifi/cacert.pem"):
            (self.source / name).write_bytes(f"fixture {name}".encode())
        self.args = linux.parser().parse_args(["stage", "--build", str(self.build), "--source-root", str(self.source),
            "--staging-base", str(self.base), "--no-patch"])
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(mock.patch.object(core, "resolve_profile", return_value=(Path("profile.json"), self.profile)))
        self.stack.enter_context(mock.patch.object(core, "code_patch_states", return_value={"docking": "source", "features": "source"}))
        self.stack.enter_context(mock.patch.object(core, "manifest_hashes_match", return_value=True))

    def make_stage(self):
        return linux.stage_client(self.args)

    def runtime_args(self, *, flatpak=False):
        self.make_stage()
        prefix = self.root / "wine prefix"
        (prefix / "drive_c").mkdir(parents=True)
        (prefix / "dosdevices").mkdir()
        (prefix / "dosdevices/z:").symlink_to("/", target_is_directory=True)
        (prefix / "system.reg").write_text("WINE REGISTRY Version 2\n")
        runner = self.root / "wine runner"
        runner.write_text("#!/bin/sh\nexit 0\n")
        runner.chmod(0o755)
        python = self.root / "windows python.exe"
        python.write_bytes(b"fixture")
        arguments = ["launch", "--build", str(self.build), "--staged-root", str(self.stage),
            "--wine-prefix", str(prefix), "--wine-runner", str(runner), "--wine-python", str(python)]
        if flatpak:
            arguments.extend(["--flatpak-app", "com.usebottles.bottles"])
        return linux.parser().parse_args(arguments)

    def test_stage_preserves_retail_and_uses_windows_binary_linux_host_marker(self):
        before = {str(path.relative_to(self.source)): path.read_bytes() for path in self.source.rglob("*") if path.is_file()}
        self.make_stage()
        marker = linux.load_owned_stage(self.stage, self.build)
        self.assertEqual(marker["platform"], "windows")
        self.assertEqual(marker["host"]["platform"], "linux")
        self.assertEqual(marker["host"]["uid"], os.getuid())
        self.assertTrue((self.stage / "ResFiles").is_symlink())
        core.verify_resfiles(self.stage, marker, core.stage_paths(self.stage, marker))
        self.assertEqual(before, {str(path.relative_to(self.source)): path.read_bytes() for path in self.source.rglob("*") if path.is_file()})

    def test_copy_cache_is_real_directory_with_all_indexed_objects(self):
        self.args.copy_resfiles = True
        self.make_stage()
        marker = linux.load_owned_stage(self.stage, self.build)
        self.assertEqual(marker["resFiles"]["mode"], "copy")
        self.assertFalse((self.stage / "ResFiles").is_symlink())
        self.assertEqual(core.verify_resfiles(self.stage, marker, core.stage_paths(self.stage, marker))["entries"], 1)

    def test_dry_run_creates_no_stage_or_lock(self):
        self.args.dry_run = True
        self.assertTrue(self.make_stage()["dryRun"])
        self.assertFalse(self.base.exists())

    def test_unknown_native_bytes_and_missing_resource_fail_before_staging(self):
        path = self.source / "bin64/blue.pyd"
        path.write_bytes(b"unknown")
        with self.assertRaisesRegex(linux.LinuxClientError, "exact unmodified"):
            self.make_stage()
        self.assertFalse(self.base.exists())
        path.write_bytes(self.blue)
        (self.cache / "aa/aabbcc").unlink()
        with self.assertRaisesRegex(core.FrontierWindowsError, "missing or redirected"):
            self.make_stage()
        self.assertFalse(self.base.exists())

    def test_source_symlink_and_overlapping_cache_staging_are_rejected(self):
        (self.source / "redirect").symlink_to(self.cache)
        with self.assertRaisesRegex(linux.LinuxClientError, "Unexpected symlink"):
            self.make_stage()
        (self.source / "redirect").unlink()
        self.args.staging_base = self.cache / "stage"
        with self.assertRaisesRegex(linux.LinuxClientError, "Resource cache"):
            self.make_stage()

    def test_failed_copy_keeps_source_and_does_not_publish_partial_stage(self):
        with mock.patch.object(core, "sha256_file", side_effect=OSError("copy verification failure")):
            with self.assertRaises(OSError):
                self.make_stage()
        self.assertFalse(self.stage.exists())
        self.assertTrue((self.source / "code.ccp").exists())

    def test_patch_uses_shared_transaction_api_after_source_isolation(self):
        self.args.no_patch = False
        with mock.patch.object(core, "patch_stage", return_value={"valid": True}) as patch:
            self.assertTrue(self.make_stage()["valid"])
        self.assertEqual(patch.call_args.args, (self.stage,))
        self.assertEqual((self.source / "bin64/blue.pyd").read_bytes(), self.blue)

    def test_existing_stage_rejects_changed_source_and_wrong_owner(self):
        self.make_stage()
        marker_path = self.stage / core.STAGE_MARKER_NAME
        marker = core.read_json(marker_path)
        marker["host"]["uid"] += 1
        core.write_json_atomic(marker_path, marker)
        with self.assertRaisesRegex(linux.LinuxClientError, "ownership"):
            self.make_stage()
        marker["host"]["uid"] = os.getuid()
        core.write_json_atomic(marker_path, marker)
        (self.source / "bin64/exefile.exe").write_bytes(b"drift")
        with self.assertRaisesRegex(core.FrontierWindowsError, "changed"):
            self.make_stage()

    def test_cleanup_cannot_follow_resource_cache_link(self):
        self.make_stage()
        self.args.clean = True
        self.make_stage()
        self.assertEqual((self.cache / "aa/aabbcc").read_bytes(), b"abc")

    def test_owned_tree_rejects_redirected_marker_and_nested_paths(self):
        self.make_stage()
        marker = self.stage / core.STAGE_MARKER_NAME
        saved = self.root / "saved.json"
        marker.rename(saved)
        marker.symlink_to(saved)
        with self.assertRaisesRegex(linux.LinuxClientError, "symlink"):
            linux.load_owned_stage(self.stage, self.build)
        marker.unlink()
        saved.rename(marker)
        (self.stage / "optional").symlink_to(self.root)
        with self.assertRaisesRegex(linux.LinuxClientError, "Unexpected symlink"):
            linux.load_owned_stage(self.stage, self.build)

    def test_lock_blocks_concurrent_stage_mutation(self):
        self.make_stage()
        with linux.stage_lock(self.stage, create=False):
            with self.assertRaisesRegex(linux.LinuxClientError, "Another client"):
                self.make_stage()

    def test_process_marker_uses_start_time_to_reject_active_and_allow_reused_pid(self):
        self.make_stage()
        runtime = self.stage / ".linux-runtime"
        runtime.mkdir()
        record = {"format": linux.PROCESS_FORMAT, "stage": str(self.stage), "pid": os.getpid(),
                  "bootId": linux.boot_id(),
                  "processStartTicks": linux.process_start(os.getpid())}
        core.write_json_atomic(runtime / "client.pid.json", record)
        with self.assertRaisesRegex(linux.LinuxClientError, "marker-owned"):
            linux.assert_not_running(self.stage)
        record["processStartTicks"] = "0"
        core.write_json_atomic(runtime / "client.pid.json", record)
        linux.assert_not_running(self.stage)

    def test_native_runner_argv_preserves_spaces_and_clears_inherited_loader(self):
        args = self.runtime_args()
        with mock.patch.dict(os.environ, {"WINELOADER": "wrong", "WINESERVER": "wrong"}):
            command, environment = linux.runtime_invocation(args, "Z:\\path with spaces\\exefile.exe", ["/arg=with spaces"], [self.stage])
        self.assertEqual(command[-2:], ["Z:\\path with spaces\\exefile.exe", "/arg=with spaces"])
        self.assertEqual(environment["WINEPREFIX"], str(args.wine_prefix))
        self.assertNotIn("WINELOADER", environment)
        self.assertNotIn("WINESERVER", environment)

    def test_flatpak_runner_argv_grants_paths_and_selects_explicit_prefix(self):
        args = self.runtime_args(flatpak=True)
        command, _ = linux.runtime_invocation(args, "Z:\\exe.exe", ["/arg=with spaces"], [self.stage])
        self.assertIn(f"--filesystem={self.stage}", command)
        self.assertIn(f"WINEPREFIX={args.wine_prefix}", command)
        self.assertIn("com.usebottles.bottles", command)
        self.assertEqual(command[-3:], [str(args.wine_runner), "Z:\\exe.exe", "/arg=with spaces"])

    def test_runtime_rejects_missing_prefix_mapping(self):
        args = self.runtime_args()
        (args.wine_prefix / "dosdevices/z:").unlink()
        with self.assertRaisesRegex(linux.LinuxClientError, "map drive Z"):
            linux.validate_runtime(args)

    def test_session_mode_and_redaction_and_override(self):
        args = self.runtime_args()
        args.session_file = self.root / "session.args"
        args.session_file.write_text("/ssoToken=secret\n/server:retail\n/cryptoPack=retail\n")
        args.session_file.chmod(0o644)
        with self.assertRaisesRegex(linux.LinuxClientError, "mode 600"):
            linux.launch_arguments(args, self.stage)
        args.session_file.chmod(0o600)
        values = linux.launch_arguments(args, self.stage)
        self.assertIn("/ssoToken=secret", values)
        self.assertIn("/server:127.0.0.1", values)
        self.assertNotIn("/server:retail", values)
        self.assertNotIn("secret", json.dumps([linux.redact(value) for value in values]))

    def test_launch_dry_run_never_executes_wine_or_trust_probe(self):
        args = self.runtime_args(flatpak=True)
        args.dry_run = True
        with mock.patch.object(core, "check_stage", return_value={"valid": True}), \
                mock.patch.object(linux, "verify_runtime_trust") as trust, \
                mock.patch.object(subprocess, "Popen") as popen:
            report = linux.launch(args)
        self.assertTrue(report["dryRun"])
        self.assertIn("JSONL-LOGPATH=Z:", " ".join(report["command"]))
        trust.assert_not_called()
        popen.assert_not_called()
        self.assertFalse((self.stage / ".linux-runtime").exists())

    def test_failed_trust_prevents_any_client_launch(self):
        args = self.runtime_args()
        with mock.patch.object(core, "check_stage", return_value={"valid": True}), \
                mock.patch.object(linux, "verify_runtime_trust", side_effect=linux.LinuxClientError("untrusted")), \
                mock.patch.object(subprocess, "Popen") as popen:
            with self.assertRaisesRegex(linux.LinuxClientError, "untrusted"):
                linux.launch(args)
        popen.assert_not_called()
        self.assertFalse((self.stage / ".linux-runtime").exists())

    def test_trust_probe_rejects_forged_fingerprint(self):
        args = self.runtime_args()
        args.ca = self.root / "ca.pem"
        args.ca.write_bytes(pem(b"fixture"))
        with mock.patch.object(core, "read_ca", return_value=(b"pem", b"der", "expected")), \
                mock.patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0,
                    json.dumps({"valid": True, "caFingerprintSha256": "wrong", "exefileSha256": "wrong"}), "")):
            with self.assertRaisesRegex(linux.LinuxClientError, "trust evidence"):
                linux.verify_runtime_trust(args, self.stage)

    def test_successful_trust_probe_is_bound_to_exact_executable_and_ca(self):
        args = self.runtime_args()
        args.ca = self.root / "ca.pem"
        args.ca.write_bytes(pem(b"fixture"))
        trust = {"valid": True, "caFingerprintSha256": "expected",
                 "exefileSha256": core.sha256_file(self.stage / "bin64/exefile.exe")}
        with mock.patch.object(core, "read_ca", return_value=(b"pem", b"der", "expected")), \
                mock.patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(trust), "")) as run:
            self.assertEqual(linux.verify_runtime_trust(args, self.stage), trust)
        invocation = run.call_args.args[0]
        self.assertIn(linux.windows_path(linux.TRUST_PROBE), invocation)
        self.assertEqual(run.call_args.kwargs["env"]["WINEPREFIX"], str(args.wine_prefix))

    def test_real_process_receives_exact_argv_and_windows_environment_paths(self):
        args = self.runtime_args()
        output = self.root / "argv result.json"
        args.wine_runner.write_text(f"#!{sys.executable}\nimport json,os,sys,time\n"
            f"with open({str(output)!r}, 'w') as stream:\n"
            " json.dump({'argv':sys.argv[1:],'prefix':os.environ['WINEPREFIX'],"
            "'cache':os.environ['EO_REMOTEFILECACHEFOLDER'],'logs':os.environ['JSONL-LOGPATH']},stream)\n"
            "time.sleep(0.1)\n")
        with mock.patch.object(core, "check_stage", return_value={"valid": True}), \
                mock.patch.object(linux, "verify_runtime_trust", return_value={"valid": True}):
            report = linux.launch(args)
        self.assertEqual(report["exitCode"], 0)
        result = json.loads(output.read_text())
        self.assertEqual(result["argv"][0], linux.windows_path(self.stage / "bin64/exefile.exe"))
        self.assertIn("/remotefilecachefolder=" + linux.windows_path(self.stage / "ResFiles"), result["argv"])
        self.assertEqual(result["cache"], linux.windows_path(self.stage / "ResFiles"))
        self.assertEqual(result["prefix"], str(args.wine_prefix))
        self.assertFalse((self.stage / ".linux-runtime/client.pid.json").exists())

    def test_explicit_trust_import_forwards_only_public_certificates_and_verifies_dapp_identity(self):
        args = self.runtime_args()
        args.ca = self.root / "ca.pem"
        args.ca.write_bytes(pem(b"game"))
        args.dapp_cert = self.root / "dapp.pem"
        args.dapp_cert.write_bytes(pem(b"dapp"))
        report = {"valid": True, "caFingerprintSha256": core.sha256_bytes(b"game"),
            "dappFingerprintSha256": core.sha256_bytes(b"dapp"),
            "exefileSha256": core.sha256_file(self.stage / "bin64/exefile.exe")}
        with mock.patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(report), "")) as run:
            self.assertEqual(linux.verify_runtime_trust(args, self.stage, install=True), report)
        invocation = run.call_args.args[0]
        self.assertIn("--install", invocation)
        self.assertIn(linux.windows_path(args.dapp_cert), invocation)
        args.dapp_cert.write_bytes(pem(b"dapp") + b"-----BEGIN PRIVATE KEY-----\nsecret\n")
        with mock.patch.object(subprocess, "run") as run:
            with self.assertRaisesRegex(linux.LinuxClientError, "never private keys"):
                linux.verify_runtime_trust(args, self.stage, install=True)
        run.assert_not_called()

    def test_status_and_stop_handle_reused_pid_without_signalling(self):
        self.make_stage()
        (self.stage / ".linux-runtime").mkdir()
        record = {"format": linux.PROCESS_FORMAT, "stage": str(self.stage), "build": self.build,
                  "pid": os.getpid(), "processStartTicks": "stale", "runner": "/fixture/wine", "prefix": "/fixture/prefix"}
        core.write_json_atomic(self.stage / ".linux-runtime/client.pid.json", record)
        args = linux.parser().parse_args(["stop", "--build", str(self.build), "--staged-root", str(self.stage)])
        with mock.patch.object(os, "kill") as kill, mock.patch.object(os, "killpg") as killpg:
            self.assertEqual(linux.runtime_status(self.stage, self.build)[0]["state"], "stale")
            self.assertEqual(linux.stop_client(args)["state"], "stopped")
        kill.assert_not_called()
        killpg.assert_not_called()

    def test_live_pid_marker_cannot_target_an_unrelated_process(self):
        self.make_stage()
        (self.stage / ".linux-runtime").mkdir()
        record = {"format": linux.PROCESS_FORMAT, "stage": str(self.stage), "build": self.build,
                  "pid": os.getpid(), "processStartTicks": linux.process_start(os.getpid()),
                  "bootId": linux.boot_id(),
                  "runner": "/not/the/current/process", "prefix": "/fixture/prefix"}
        core.write_json_atomic(self.stage / ".linux-runtime/client.pid.json", record)
        with self.assertRaisesRegex(linux.LinuxClientError, "no longer identifies"):
            linux.runtime_status(self.stage, self.build)

    def test_windows_trust_helper_rejects_private_or_multiple_certificates(self):
        path = self.root / "public.pem"
        path.write_bytes(pem(b"fixture"))
        self.assertEqual(probe.read_public_der(path), b"fixture")
        path.write_bytes(pem(b"fixture") + pem(b"second"))
        with self.assertRaisesRegex(RuntimeError, "exactly one"):
            probe.read_public_der(path)
        path.write_bytes(pem(b"fixture") + b"-----BEGIN RSA PRIVATE KEY-----\nsecret\n")
        with self.assertRaisesRegex(RuntimeError, "never private keys"):
            probe.read_public_der(path)

    def test_signature_negative_control_changes_only_one_section_byte(self):
        original = make_pe_source()
        tampered = probe.tampered_pe_bytes(original)
        self.assertEqual(len(tampered), len(original))
        self.assertEqual(sum(left != right for left, right in zip(original, tampered)), 1)
        self.assertEqual(core.parse_pe_layout(tampered), core.parse_pe_layout(original))
        with self.assertRaisesRegex(RuntimeError, "MZ"):
            probe.tampered_pe_bytes(b"unsigned")

    def test_background_process_status_stop_and_boot_identity(self):
        args = self.runtime_args()
        args.background = True
        args.wine_runner.write_text(f"#!{sys.executable}\nimport time\ntime.sleep(10)\n")
        with mock.patch.object(core, "check_stage", return_value={"valid": True}), \
                mock.patch.object(linux, "verify_runtime_trust", return_value={"valid": True}):
            report = linux.launch(args)
        self.addCleanup(lambda: self.reap_child(report["pid"]))
        self.assertEqual(linux.runtime_status(self.stage, self.build)[0]["state"], "running")
        with mock.patch.object(linux, "boot_id", return_value="different-boot"):
            self.assertEqual(linux.runtime_status(self.stage, self.build)[0]["state"], "stale")
        stop_args = linux.parser().parse_args(["stop", "--build", str(self.build), "--staged-root", str(self.stage)])
        self.assertEqual(linux.stop_client(stop_args)["state"], "stop-requested")
        os.waitpid(report["pid"], 0)
        self.assertEqual(linux.stop_client(stop_args)["state"], "stopped")

    @staticmethod
    def reap_child(pid):
        try:
            os.kill(pid, 15)
            os.waitpid(pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass
        linux.reap_background_children()


if __name__ == "__main__":
    unittest.main()
