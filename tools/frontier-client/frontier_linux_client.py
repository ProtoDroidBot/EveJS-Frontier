#!/usr/bin/env python3
"""Stage Windows Frontier binaries on Linux and launch through an explicit Wine prefix.

Offline patch/check reuse frontier_windows_client's exact-build transactions.
Launch additionally checks Windows Authenticode and the Wine ROOT store through
Windows Python in the selected prefix. The explicit trust command installs
only selected public certificates in that prefix; retail files remain intact.
Runtime acceptance remains a separate live test.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid

import frontier_windows_client as core

HOST_FORMAT = "evejs-frontier-linux-host-v1"
PROCESS_FORMAT = "evejs-frontier-linux-client-process-v1"
HERE = Path(__file__).resolve().parent
TRUST_PROBE = HERE / "frontier_wine_trust_probe.py"
BACKGROUND_CHILDREN: dict[int, subprocess.Popen] = {}


class LinuxClientError(RuntimeError):
    pass


def reap_background_children() -> None:
    """Keep detached Popen handles when embedded, and reap completed own children."""
    for pid, process in list(BACKGROUND_CHILDREN.items()):
        if process.poll() is not None:
            BACKGROUND_CHILDREN.pop(pid, None)


def absolute(path: Path | str) -> Path:
    return Path(os.path.abspath(Path(path).expanduser()))


def no_links(path: Path, *, missing_ok=False) -> None:
    """Inspect the lexical path before resolving it, including all ancestors."""
    path = absolute(path)
    for candidate in (*reversed(path.parents), path):
        try:
            info = candidate.lstat()
        except FileNotFoundError:
            if missing_ok:
                continue
            raise LinuxClientError(f"Required path is missing: {candidate}")
        if stat.S_ISLNK(info.st_mode):
            raise LinuxClientError(f"Refusing a symlink path component: {candidate}")


def no_tree_links(root: Path, *, allowed: Path | None = None) -> None:
    no_links(root)
    for directory, directories, filenames in os.walk(root, followlinks=False):
        for name in (*directories, *filenames):
            item = Path(directory) / name
            if item.is_symlink() and item != allowed:
                raise LinuxClientError(f"Unexpected symlink in owned tree: {item}")


def owner_file(path: Path) -> None:
    no_links(path)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise LinuxClientError(f"Expected a current-user-owned regular file: {path}")


@contextmanager
def stage_lock(stage: Path, *, create: bool):
    no_links(stage.parent, missing_ok=create)
    if create:
        stage.parent.mkdir(parents=True, exist_ok=True)
    lock = stage.parent / f".{stage.name}.linux.lock"
    flags = os.O_RDWR | os.O_NOFOLLOW | (os.O_CREAT if create else 0)
    descriptor = os.open(lock, flags, 0o600)
    try:
        if os.fstat(descriptor).st_uid != os.getuid():
            raise LinuxClientError(f"Stage lock belongs to another user: {lock}")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise LinuxClientError("Another client/staging operation owns this stage.") from error
        yield descriptor
    finally:
        os.close(descriptor)


def load_owned_stage(stage: Path, build: int) -> dict:
    stage = absolute(stage)
    no_links(stage)
    owner_file(stage / core.STAGE_MARKER_NAME)
    _, marker = core.load_stage(stage)
    host = marker.get("host")
    if int(marker["build"]) != build or host != {
        "format": HOST_FORMAT, "platform": "linux", "uid": os.getuid(),
        "binaryPlatform": "windows",
    }:
        raise LinuxClientError("Stage build or Linux host ownership does not match.")
    no_tree_links(stage, allowed=stage / "ResFiles")
    if marker.get("sourceSync"):
        raise LinuxClientError("Linux tooling does not accept retail-synced stages.")
    return marker


def process_start(pid: int) -> str | None:
    try:
        # comm may contain spaces and parentheses; fields after its last ')' start at 3.
        fields = (Path("/proc") / str(pid) / "stat").read_text().rsplit(")", 1)[1].split()
        return None if fields[0] == "Z" else fields[19]
    except FileNotFoundError:
        return None


def boot_id() -> str:
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def process_identity(pid: int, stage: Path, prefix: Path) -> dict:
    proc = Path("/proc") / str(pid)
    argv_bytes = (proc / "cmdline").read_bytes()
    argv = argv_bytes.decode(errors="replace").split("\0")
    environment = (proc / "environ").read_bytes().decode(errors="replace").split("\0")
    expected = {str(stage / "bin64/exefile.exe"), windows_path(stage / "bin64/exefile.exe")}
    cwd = os.readlink(proc / "cwd")
    checks = {"user": proc.stat().st_uid == os.getuid(), "staged executable": bool(expected.intersection(argv)),
              "working directory": cwd == str(stage / "bin64"), "prefix": f"WINEPREFIX={prefix}" in environment}
    if not all(checks.values()):
        raise LinuxClientError("Live PID no longer identifies this stage: " + ", ".join(key for key, valid in checks.items() if not valid))
    return {"bootId": boot_id(), "processStartTicks": process_start(pid),
            "processExecutable": os.readlink(proc / "exe"), "cwd": cwd,
            "commandSha256": hashlib.sha256(argv_bytes).hexdigest()}


def remove_matching_process_marker(path: Path, record: dict) -> None:
    if path.exists():
        owner_file(path)
        if core.read_json(path) == record:
            path.unlink()


def wait_for_process_identity(process, stage: Path, prefix: Path) -> dict:
    """Let exec/loader transitions settle before recording a strict /proc snapshot."""
    deadline = time.monotonic() + 2
    previous = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise LinuxClientError("Wine exited before the client process could be recorded.")
        try:
            identity = process_identity(process.pid, stage, prefix)
            if identity == previous and identity["processStartTicks"] is not None:
                return identity
            previous = identity
        except (FileNotFoundError, LinuxClientError):
            previous = None
        time.sleep(0.02)
    raise LinuxClientError("Could not establish a stable staged-client process identity.")


def windows_path(path: Path) -> str:
    return "Z:" + str(absolute(path)).replace("/", "\\")


def assert_not_running(stage: Path) -> None:
    expected = {str(stage / "bin64/exefile.exe"), windows_path(stage / "bin64/exefile.exe")}
    marker_path = stage / ".linux-runtime/client.pid.json"
    if marker_path.exists():
        owner_file(marker_path)
        record = core.read_json(marker_path)
        if record.get("format") != PROCESS_FORMAT or record.get("stage") != str(stage):
            raise LinuxClientError("Cannot verify the Linux client process marker.")
        if record.get("bootId") == boot_id() and process_start(int(record["pid"])) == record.get("processStartTicks"):
            raise LinuxClientError("The stage's marker-owned client is running.")
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        try:
            args = (process / "cmdline").read_bytes().decode(errors="replace").split("\0")
        except FileNotFoundError:
            continue
        except PermissionError as error:
            # Other users cannot own our private stage, but an unreadable process
            # from this user prevents proving that cleanup is safe.
            if process.stat().st_uid == os.getuid():
                raise LinuxClientError(f"Cannot inspect same-user process {process.name}.") from error
            continue
        if expected.intersection(args):
            raise LinuxClientError(f"The staged executable is running (pid={process.name}).")


def options(args) -> dict:
    return {"node_path": args.node, "ca_path": args.ca,
            "xmpp_leaf": args.xmpp_leaf, "gateway_leaf": args.gateway_leaf}


def source_details(source: Path, build: int) -> tuple[str, dict, Path, dict]:
    no_tree_links(source)
    core.verify_start_ini(source / "start.ini", build)
    natives = [name for name in ("blue.pyd", "blue.dll") if (source / "bin64" / name).is_file()]
    if len(natives) != 1:
        raise LinuxClientError("Expected exactly one native Windows blue.pyd/blue.dll.")
    native = natives[0]
    _, profile = core.resolve_profile(build, native)
    if core.inspect_blue(source / "bin64" / native, profile) != "source":
        raise LinuxClientError("Source native blue is not the exact unmodified build.")
    if core.code_patch_states(source / "code.ccp", build) != core.expected_code_states(build, "source"):
        raise LinuxClientError("Source code archive is not the exact unmodified build.")
    if not core.manifest_hashes_match(source / "manifest.dat", source, profile):
        raise LinuxClientError("Source manifest digests do not match the selected build.")
    resfiles = core.discover_official_resfiles(source)
    core.verify_resource_index(source / "resfileindex.txt", resfiles)
    relatives = {f"bin64/{native}", "code.ccp", "manifest.dat", "start.ini",
                 "resfileindex.txt", "bin64/exefile.exe", "bin64/cacert.pem",
                 "bin64/packages/certifi/cacert.pem"}
    relatives.update(path.name for path in source.glob("*.ini"))
    hashes = {name: core.sha256_file(source / name) for name in sorted(relatives)}
    return native, profile, resfiles, hashes


def stage_client(args) -> dict:
    source = absolute(args.source_root)
    base = absolute(args.staging_base)
    stage = base / str(args.build)
    no_links(base, missing_ok=True)
    if source == base or core.is_within(base, source) or core.is_within(source, base):
        raise LinuxClientError("Source and staging directories must not overlap.")
    native, profile, resfiles, hashes = source_details(source, args.build)
    if core.is_within(base, resfiles) or core.is_within(resfiles, base):
        raise LinuxClientError("Resource cache and staging directories must not overlap.")
    if args.dry_run:
        if stage.exists():
            load_owned_stage(stage, args.build)
        return {"dryRun": True, "build": args.build, "source": str(source),
                "stage": str(stage), "resFilesMode": "copy" if args.copy_resfiles else "junction"}
    with stage_lock(stage, create=True):
        if stage.exists():
            marker = load_owned_stage(stage, args.build)
            if Path(marker["sourceRoot"]) != source:
                raise LinuxClientError("Existing stage belongs to a different source.")
            assert_not_running(stage)
            if args.clean:
                # Verify the official cache link and source hashes before deleting
                # only the owned stage; rmtree never traverses the cache symlink.
                core.verify_resfiles(stage, marker, core.stage_paths(stage, marker))
                core.verify_retail_unchanged(marker, stage)
                no_tree_links(stage, allowed=stage / "ResFiles")
                shutil.rmtree(stage)
            else:
                if args.no_patch:
                    paths = core.stage_paths(stage, marker)
                    core.verify_retail_unchanged(marker, stage)
                    core.verify_resfiles(stage, marker, paths)
                    if marker["patchState"] == "unpatched":
                        core.verify_unpatched_stage_sources(stage, marker, paths, profile)
                    else:
                        core.check_stage(stage, **options(args))
                    return {"stage": str(stage), "patchState": marker["patchState"],
                            "binaryPlatform": "windows", "hostPlatform": "linux"}
                return core.patch_stage(stage, **options(args))
        temporary = base / f".{args.build}.initializing-{uuid.uuid4().hex}"
        try:
            shutil.copytree(source, temporary, symlinks=True)
            no_tree_links(temporary)
            if (temporary / "ResFiles").exists():
                raise LinuxClientError("Build tree unexpectedly contains a ResFiles directory.")
            if args.copy_resfiles:
                no_tree_links(resfiles)
                shutil.copytree(resfiles, temporary / "ResFiles")
                cache = {"mode": "copy", "path": str(stage / "ResFiles"), "sourceTarget": str(resfiles)}
            else:
                (temporary / "ResFiles").symlink_to(resfiles, target_is_directory=True)
                cache = {"mode": "junction", "path": str(stage / "ResFiles"),
                         "target": str(resfiles), "sharedWritableCache": True}
            for relative, digest in hashes.items():
                if core.sha256_file(temporary / relative) != digest or core.sha256_file(source / relative) != digest:
                    raise LinuxClientError(f"Source or staged copy changed during staging: {relative}")
            (temporary / "common.ini").write_text("[main]\ncryptoPack = Placebo\n", encoding="utf-8")
            original = dict(hashes)
            # common.ini is an intentional boot overlay, not a retail-file mutation.
            # The shared core validates every original hash before patching.
            if "common.ini" in original:
                raise LinuxClientError("Source common.ini would be replaced; use a pristine build without an overlay.")
            marker = {"format": core.STAGE_FORMAT, "platform": "windows", "build": args.build,
                      "stagePath": str(stage), "stagingBase": str(base), "sourceRoot": str(source),
                      "nativeBlue": native, "retailHashesBefore": hashes,
                      "retailHashesAfterStage": hashes, "originalHashes": original,
                      "currentHashes": original, "resFiles": cache, "bootCryptoPack": "Placebo",
                      "patchState": "unpatched", "host": {"format": HOST_FORMAT,
                      "platform": "linux", "uid": os.getuid(), "binaryPlatform": "windows"}}
            core.write_json_atomic(temporary / core.STAGE_MARKER_NAME, marker)
            temporary.rename(stage)
        except Exception:
            if temporary.exists():
                shutil.rmtree(temporary)
            raise
        # The shared core owns transactional mutation/rollback after publication.
        if args.no_patch:
            return {"stage": str(stage), "patchState": "unpatched", "build": args.build}
        return core.patch_stage(stage, **options(args))


def validate_runtime(args) -> tuple[Path, Path, Path]:
    runner = absolute(args.wine_runner).resolve(strict=True)
    prefix = absolute(args.wine_prefix)
    python = absolute(args.wine_python).resolve(strict=True)
    if not runner.is_file() or not os.access(runner, os.X_OK):
        raise LinuxClientError("Selected Wine runner is not executable.")
    if not python.is_file():
        raise LinuxClientError("Selected Windows Python executable is missing.")
    if args.flatpak_app and not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+){2,}", args.flatpak_app):
        raise LinuxClientError("Invalid Flatpak application ID.")
    no_links(prefix)
    if prefix.stat().st_uid != os.getuid() or not (prefix / "system.reg").is_file() or not (prefix / "drive_c").is_dir():
        raise LinuxClientError("Select an existing current-user-owned Wine/Bottles prefix.")
    try:
        maps_root = os.path.samefile(prefix / "dosdevices/z:", "/")
    except FileNotFoundError:
        maps_root = False
    if not maps_root:
        raise LinuxClientError("The selected prefix must map drive Z: to the Linux filesystem root.")
    return runner, prefix, python


def runtime_invocation(args, executable: str, arguments: list[str], mounts: list[Path], *, read_only=()) -> tuple[list[str], dict]:
    runner, prefix, _ = validate_runtime(args)
    environment = dict(os.environ)
    # Do not accidentally borrow a different runner's server/loader configuration.
    for key in ("WINELOADER", "WINESERVER", "WINEDLLPATH"):
        environment.pop(key, None)
    environment["WINEPREFIX"] = str(prefix)
    if not args.flatpak_app:
        return [str(runner), executable, *arguments], environment
    paths = {absolute(path) for path in (prefix, runner.parent.parent, HERE, absolute(args.wine_python).parent, *mounts)}
    protected = {absolute(path) for path in (runner.parent.parent, HERE, absolute(args.wine_python).parent, *read_only)}
    if any(any(char in str(path) for char in "\0\r\n:") for path in paths):
        raise LinuxClientError("Flatpak filesystem paths cannot contain colons or line breaks.")
    command = [args.flatpak_bin, "run", "--command=env",
               *[f"--filesystem={path}{':ro' if path in protected else ''}" for path in sorted(paths)], args.flatpak_app,
               "-u", "WINELOADER", "-u", "WINESERVER", "-u", "WINEDLLPATH",
               f"WINEPREFIX={prefix}", str(runner), executable, *arguments]
    return command, environment


def verify_runtime_trust(args, stage: Path, *, install: bool = False) -> dict:
    for path in [args.ca, *([args.dapp_cert] if install else [])]:
        if b"PRIVATE KEY" in path.read_bytes():
            raise LinuxClientError("Prefix trust accepts public certificate files only, never private keys.")
    _, ca_der, fingerprint = core.read_ca(args.ca)
    exefile = stage / "bin64/exefile.exe"
    marker = load_owned_stage(stage, args.build)
    mounts = [stage, Path(marker["sourceRoot"]), Path(marker["resFiles"].get("target", stage / "ResFiles")), args.ca.parent]
    probe_arguments = ["-I", windows_path(TRUST_PROBE), "--exefile", windows_path(exefile),
                       "--ca", windows_path(args.ca)]
    if install:
        _, dapp_der, dapp_fingerprint = core.read_ca(args.dapp_cert)
        del dapp_der
        mounts.append(absolute(args.dapp_cert).parent)
        probe_arguments.extend(["--install", "--dapp-cert", windows_path(args.dapp_cert)])
    command, environment = runtime_invocation(args, windows_path(args.wine_python), probe_arguments, mounts,
        read_only=[Path(marker["sourceRoot"]), absolute(args.ca).parent,
                   *([absolute(args.dapp_cert).parent] if install else [])])
    result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise LinuxClientError("Wine Authenticode/ROOT trust check failed. Trust the public EveJS CA in the selected prefix and verify the unmodified signed executable. " + result.stderr[-1500:])
    try:
        report = json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as error:
        raise LinuxClientError("Wine trust probe did not return valid JSON.") from error
    if (report.get("valid") is not True or report.get("caFingerprintSha256") != fingerprint
            or report.get("exefileSha256") != core.sha256_file(exefile)):
        raise LinuxClientError("Wine trust evidence does not match this CA and staged executable.")
    if install and report.get("dappFingerprintSha256") != dapp_fingerprint:
        raise LinuxClientError("Wine trust evidence does not match the selected dApp public certificate.")
    return report


def launch_arguments(args, stage: Path) -> list[str]:
    values = []
    if args.session_file:
        owner_file(args.session_file)
        if stat.S_IMODE(args.session_file.stat().st_mode) != 0o600:
            raise LinuxClientError("Captured session file must have mode 600.")
        values = [line.strip() for line in args.session_file.read_text().splitlines()
                  if line.strip() and not line.lstrip().startswith("#")]
    overrides = {"/noconsole": "/noconsole", "/server:": "/server:127.0.0.1",
                 "/tenant=": "/tenant=dev", "/settingsprofile=": f"/settingsprofile={args.settings_profile}",
                 "/language=": "/language=en", "/cryptopack=": "/cryptoPack=Placebo",
                 "/remotefilecachefolder=": f"/remotefilecachefolder={windows_path(stage / 'ResFiles')}"}
    return [value for value in values if not any(value.lower().startswith(prefix) for prefix in overrides)] + list(overrides.values())


def redact(value: str) -> str:
    if re.match(r"(?i)^(?:/(?:ssoToken|refreshToken|LauncherData|deviceID|machineHash|journeyID)=|exp=)", value):
        return value.split("=", 1)[0] + "=***"
    return value


def launch(args) -> dict:
    reap_background_children()
    stage = absolute(args.staged_root)
    with stage_lock(stage, create=False) as lock_descriptor:
        marker = load_owned_stage(stage, args.build)
        assert_not_running(stage)
        report = core.check_stage(stage, **options(args))
        validate_runtime(args)
        arguments = launch_arguments(args, stage)
        logroot = stage / ".linux-runtime/logs"
        cache = Path(marker["resFiles"].get("target", stage / "ResFiles"))
        command, environment = runtime_invocation(args, windows_path(stage / "bin64/exefile.exe"), arguments,
            [stage, Path(marker["sourceRoot"]), cache], read_only=[Path(marker["sourceRoot"])])
        client_environment = {"EO_REMOTEFILECACHEFOLDER": windows_path(stage / "ResFiles"),
                              "FRONTIER_PUBLIC_GATEWAY_ADDRESS": "127.0.0.1:26103",
                              "FRONTIER_PUBLIC_GATEWAY_IS_SECURE": "1", "JSONL-LOGPATH": windows_path(logroot)}
        if args.flatpak_app:
            # env runs inside the sandbox; host-side environment alone is not an
            # adequate guarantee for names containing '-' or Flatpak filtering.
            runner_index = command.index(str(absolute(args.wine_runner).resolve()))
            command[runner_index:runner_index] = [f"{key}={value}" for key, value in client_environment.items()]
        else:
            environment.update(client_environment)
        if args.dry_run:
            return {"dryRun": True, "stageValid": report.get("valid", False),
                    "runtimeTrust": "not-probed; mandatory before launch", "command": [redact(value) for value in command],
                    "environment": client_environment, "prefix": str(absolute(args.wine_prefix))}
        trust = verify_runtime_trust(args, stage)
        runtime_root = stage / ".linux-runtime"
        runtime_root.mkdir(mode=0o700, exist_ok=True)
        runtime_root.chmod(0o700)
        logroot.mkdir(mode=0o700, exist_ok=True)
        pidfile = stage / ".linux-runtime/client.pid.json"
        stdout = stderr = None
        process = None
        try:
            if args.background:
                stdout = (logroot / "stdout.log").open("ab")
                stderr = (logroot / "stderr.log").open("ab")
                os.chmod(logroot / "stdout.log", 0o600)
                os.chmod(logroot / "stderr.log", 0o600)
            process = subprocess.Popen(command, env=environment, cwd=stage / "bin64",
                stdout=stdout, stderr=stderr, start_new_session=args.background)
            ticks = process_start(process.pid)
            if ticks is None or process.poll() is not None:
                raise LinuxClientError("Wine exited before the client process could be recorded.")
            identity = wait_for_process_identity(process, stage, absolute(args.wine_prefix))
            record = {"format": PROCESS_FORMAT, "pid": process.pid,
                **identity, "stage": str(stage), "prefix": str(absolute(args.wine_prefix)),
                "runner": str(absolute(args.wine_runner).resolve()), "build": args.build,
                "background": args.background}
            core.write_json_atomic(pidfile, record)
            # Mutators will now observe the exact owned process marker and /proc
            # identity. Releasing allows stop to take the same lock while a
            # foreground launcher waits for its client.
            fcntl.flock(lock_descriptor, fcntl.LOCK_UN)
            if args.background:
                BACKGROUND_CHILDREN[process.pid] = process
                return {"pid": process.pid, "stage": str(stage), "runtimeTrust": trust,
                        "acceptance": "launch requested; live gameplay unvalidated"}
            code = process.wait()
            remove_matching_process_marker(pidfile, record)
            return {"exitCode": code, "stage": str(stage), "runtimeTrust": trust}
        except BaseException:
            if process is not None and process.poll() is None:
                if args.background:
                    os.killpg(process.pid, signal.SIGTERM)
                else:
                    process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            raise
        finally:
            for stream in (stdout, stderr):
                if stream is not None:
                    stream.close()


def runtime_status(stage: Path, build: int) -> tuple[dict, dict | None]:
    reap_background_children()
    load_owned_stage(stage, build)
    pidfile = stage / ".linux-runtime/client.pid.json"
    if not pidfile.exists():
        return {"state": "stopped", "stage": str(stage), "build": build}, None
    owner_file(pidfile)
    record = core.read_json(pidfile)
    if (record.get("format") != PROCESS_FORMAT or record.get("stage") != str(stage)
            or record.get("build") != build or not isinstance(record.get("pid"), int)
            or record["pid"] <= 1 or not record.get("prefix") or not record.get("runner")):
        raise LinuxClientError("Cannot verify the marker-owned client identity.")
    state = "stale"
    if (record.get("bootId") == boot_id()
            and process_start(record["pid"]) == record.get("processStartTicks")):
        try:
            identity = process_identity(record["pid"], stage, Path(record["prefix"]))
            if any(identity[key] != record.get(key) for key in identity):
                raise LinuxClientError("Live PID executable, command or working directory changed since launch.")
            state = "running"
        except FileNotFoundError:
            pass
    return {"state": state, "stage": str(stage), "build": build, "pid": record["pid"]}, record


def stop_client(args) -> dict:
    stage = absolute(args.staged_root)
    with stage_lock(stage, create=False):
        return stop_client_locked(args, stage)


def stop_client_locked(args, stage: Path) -> dict:
    report, record = runtime_status(stage, args.build)
    if args.dry_run or record is None:
        report["dryRun"] = args.dry_run
        return report
    if report["state"] == "running":
        pid = record["pid"]
        # Revalidate immediately before the signal. Never use a prefix-wide
        # wineserver kill, which could terminate unrelated applications.
        fresh, _ = runtime_status(stage, args.build)
        if fresh["state"] == "running":
            if record.get("background") and os.getpgid(pid) == pid:
                os.killpg(pid, signal.SIGTERM)
            else:
                os.kill(pid, signal.SIGTERM)
        # Preserve the marker while the process is still alive. A follow-up
        # status/stop can observe exit without a blind PID kill or escalation.
        report["state"] = "stop-requested"
        return report
    pidfile = stage / ".linux-runtime/client.pid.json"
    remove_matching_process_marker(pidfile, record)
    return {"state": "stopped", "stage": str(stage), "build": args.build}


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(description=__doc__)
    commands = cli.add_subparsers(dest="command", required=True)
    for name in ("stage", "patch", "check", "launch", "trust", "status", "stop"):
        command = commands.add_parser(name)
        command.add_argument("--build", type=int, required=True)
        command.add_argument("--node", type=Path)
        command.add_argument("--ca", type=Path, default=core.DEFAULT_CA)
        command.add_argument("--xmpp-leaf", type=Path, default=core.DEFAULT_XMPP_LEAF)
        command.add_argument("--gateway-leaf", type=Path, default=core.DEFAULT_GATEWAY_LEAF)
        command.add_argument("--dry-run", action="store_true")
        if name == "stage":
            command.add_argument("--source-root", type=Path, required=True, help="Windows build root containing start.ini")
            command.add_argument("--staging-base", type=Path, required=True)
            command.add_argument("--copy-resfiles", action="store_true")
            command.add_argument("--no-patch", action="store_true")
            command.add_argument("--clean", action="store_true")
        else:
            command.add_argument("--staged-root", type=Path, required=True)
        if name in {"launch", "trust"}:
            command.add_argument("--wine-runner", type=Path, required=True)
            command.add_argument("--wine-prefix", type=Path, required=True)
            command.add_argument("--wine-python", type=Path, required=True, help="Windows CPython 3.12 x64 executable used for prefix trust checks")
            command.add_argument("--flatpak-app", help="For example com.usebottles.bottles; runs the selected Wine runner inside this sandbox")
            command.add_argument("--flatpak-bin", default="flatpak")
        if name == "trust":
            command.add_argument("--dapp-cert", type=Path, required=True,
                                 help="Generated public dApp certificate; private keys are rejected")
        if name == "launch":
            command.add_argument("--settings-profile", default="EveJSFrontierLinux")
            command.add_argument("--session-file", type=Path)
            command.add_argument("--background", action="store_true")
    return cli


def run(args) -> dict:
    if args.build <= 0:
        raise LinuxClientError("Build must be positive.")
    if args.command == "stage":
        return stage_client(args)
    if args.command == "status":
        return runtime_status(absolute(args.staged_root), args.build)[0]
    if args.command == "stop":
        return stop_client(args)
    if args.command == "launch":
        if not re.fullmatch(r"[A-Za-z0-9._-]+", args.settings_profile):
            raise LinuxClientError("Settings profile contains unsupported characters.")
        return launch(args)
    stage = absolute(args.staged_root)
    with stage_lock(stage, create=False):
        marker = load_owned_stage(stage, args.build)
        if args.dry_run:
            return {"dryRun": True, "stage": str(stage), "patchState": marker["patchState"],
                    "scope": "ownership only; full patch/chain checks require check"}
        if args.command == "trust":
            assert_not_running(stage)
            core.check_stage(stage, **options(args))
            return verify_runtime_trust(args, stage, install=True)
        if args.command == "patch":
            assert_not_running(stage)
            return core.patch_stage(stage, **options(args))
        return core.check_stage(stage, **options(args))


def main() -> int:
    args = parser().parse_args()
    try:
        if sys.platform != "linux":
            raise LinuxClientError("This entrypoint supports Linux hosts only.")
        if sys.version_info[:2] != (3, 12):
            raise LinuxClientError("Native CPython 3.12 exactly is required; set EVEJS_FRONTIER_NATIVE_PYTHON312.")
        report = run(args)
        if args.command in {"stage", "patch", "check"}:
            report["runtimeTrust"] = "not-probed; mandatory selected-prefix checks on launch"
            report["liveAcceptanceValidated"] = False
        if args.command == "trust":
            report["scope"] = "selected-prefix public ROOT certificates; launch separately requires Authenticode validation"
        print(json.dumps(report, sort_keys=True))
        return int(report.get("exitCode", 0))
    except (LinuxClientError, core.FrontierWindowsError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"[evejs-frontier] {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
