from __future__ import annotations

import sys
from pathlib import Path

from elysian_fsd.evejs import configured_client_root, repository_root


APP_ROOT = (
    Path(sys.executable).resolve().parent
    if getattr(sys, "frozen", False)
    else Path(__file__).resolve().parent.parent
)
REPO_ROOT = repository_root(APP_ROOT)
RUNTIME_ROOT = APP_ROOT / "runtime"
PROJECTS_ROOT = APP_ROOT / "projects"


def ensure_directories() -> None:
    for path in (RUNTIME_ROOT, RUNTIME_ROOT / "staging", PROJECTS_ROOT):
        path.mkdir(parents=True, exist_ok=True)


def default_client_root() -> Path:
    return configured_client_root(REPO_ROOT)


def default_server_root() -> Path:
    return REPO_ROOT / "server"
