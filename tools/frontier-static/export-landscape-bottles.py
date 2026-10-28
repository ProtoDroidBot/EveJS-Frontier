#!/usr/bin/env python3
"""Run the exact-client landscape decoder through Bottles on Linux.

Requires an already unpacked official Windows CPython 3.12 amd64 embeddable
runtime and an installed Bottles Wine runner. Nothing is downloaded. Every run
uses its own disposable Wine prefix; the installed client and runtime are
mounted read-only. Use --probe to check the worker without decoding resources.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile

PROBE = """import json, os, struct, sys
assert os.name == 'nt', os.name
assert sys.version_info[:2] == (3, 12), sys.version
assert struct.calcsize('P') == 8, '64-bit CPython is required'
print(json.dumps({'python': sys.version, 'platform': sys.platform, 'bits': 64}))
"""


def windows_path(path):
    """Wine's fresh default prefix maps the Linux filesystem to drive Z."""
    return "Z:" + str(Path(path).resolve()).replace("/", "\\")


def validate_paths(args):
    for name in ("python_runtime", "client_root", "output", "runner"):
        path = Path(getattr(args, name)).expanduser().resolve()
        if any(character in str(path) for character in ("\0", "\n", "\r", ":")):
            raise ValueError(f"{name} contains a character unsupported by Flatpak filesystem grants")
        setattr(args, name, path)
    for path in (
        args.python_runtime / "python.exe", args.python_runtime / "python312.dll",
        args.python_runtime / "python312.zip", args.client_root / "stillness" / "start.ini",
        args.client_root / "stillness" / "code.ccp", args.runner,
    ):
        if not path.is_file():
            raise ValueError(f"Required input file does not exist: {path}")
    if not (args.client_root / "stillness" / "bin64").is_dir():
        raise ValueError("Client root must contain stillness/bin64")
    if not os.access(args.runner, os.X_OK):
        raise ValueError(f"Wine runner is not executable: {args.runner}")
    # An output ancestor would also grant writable access to protected inputs.
    protected = (args.client_root, args.python_runtime, args.runner.parent.parent)
    for source in protected:
        if args.output.is_relative_to(source) or source.is_relative_to(args.output):
            raise ValueError(f"Output directory must not overlap input directory: {source}")
    if args.output.exists() and not args.output.is_dir():
        raise ValueError(f"Output is not a directory: {args.output}")
    if args.timeout <= 0:
        raise ValueError("Timeout must be positive")


def worker_command(args, workspace, command, *, exporter):
    """Build argv directly: paths and user values are never shell programs."""
    workspace = Path(workspace).resolve()
    mounts = [
        str(workspace), str(args.python_runtime) + ":ro",
        str(args.client_root) + ":ro", str(args.runner.parent.parent) + ":ro",
        str(exporter.parent) + ":ro",
    ]
    if not args.probe:
        mounts.append(str(args.output))
    return [
        args.flatpak_bin, "run", "--command=env",
        *["--filesystem=" + mount for mount in dict.fromkeys(mounts)],
        args.flatpak_app,
        "-u", "WINELOADER", "-u", "WINESERVER", "-u", "WINEDLLPATH",
        "WINEARCH=win64", "WINEPREFIX=" + str(workspace / "wineprefix"),
        "WINEDEBUG=-all", "WINEDLLOVERRIDES=winemenubuilder.exe=d",
        *[str(value) for value in command],
    ]


def run(args):
    validate_paths(args)
    exporter = Path(__file__).resolve().with_name("export-landscape-native.py")
    if not exporter.is_file():
        raise ValueError(f"Native exporter is missing: {exporter}")
    if not args.probe:
        args.output.mkdir(parents=True, exist_ok=True)
    # Never reuse the caller's WINEPREFIX or any existing Bottles prefix.
    with tempfile.TemporaryDirectory(prefix="evejs-landscape-worker-") as directory:
        workspace = Path(directory)
        if args.probe:
            script = workspace / "probe.py"
            script.write_text(PROBE, encoding="utf-8")
            script_args = []
        else:
            script = exporter
            script_args = ["--client-root", windows_path(args.client_root),
                           "--output", windows_path(args.output)]
        command = worker_command(args, workspace, [args.runner,
            args.python_runtime / "python.exe", "-I", windows_path(script), *script_args], exporter=exporter)
        try:
            return subprocess.run(command, timeout=args.timeout, check=False).returncode
        finally:
            # Only stop processes associated with our freshly created prefix.
            # Without this, Wine may retain files while TemporaryDirectory exits.
            wineserver = args.runner.with_name("wineserver")
            if wineserver.is_file():
                for operation in ("-k", "-w"):
                    try:
                        subprocess.run(worker_command(args, workspace,
                            [wineserver, operation], exporter=exporter),
                            timeout=15, check=False, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
                    except (OSError, subprocess.TimeoutExpired):
                        pass


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--python-runtime", required=True, type=Path,
                        help="Unpacked official Windows CPython 3.12 amd64 embeddable runtime")
    result.add_argument("--client-root", required=True, type=Path,
                        help="Build 3640684 directory containing stillness and ResFiles")
    result.add_argument("--output", required=True, type=Path, help="Decoded JSONL and manifest destination")
    result.add_argument("--runner", required=True, type=Path, help="Installed Bottles runner's bin/wine executable")
    result.add_argument("--flatpak-app", default="com.usebottles.bottles")
    result.add_argument("--flatpak-bin", default="flatpak")
    result.add_argument("--timeout", type=float, default=900, help="Worker timeout in seconds (default: 900)")
    result.add_argument("--probe", action="store_true", help="Verify Windows Python version/architecture without exporting")
    return result


def main():
    args = parser().parse_args()
    try:
        return run(args)
    except subprocess.TimeoutExpired:
        print(f"Landscape worker exceeded {args.timeout:g} seconds", file=sys.stderr)
        return 124
    except (OSError, ValueError) as error:
        print(f"Landscape worker failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
