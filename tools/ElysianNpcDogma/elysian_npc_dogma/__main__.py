from __future__ import annotations

import sys

from .paths import ensure_directories


def main(argv: list[str] | None = None) -> int:
    ensure_directories()
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments:
        from .cli import main as cli_main

        return cli_main(arguments)
    from .ui.app import run

    return run()


if __name__ == "__main__":
    raise SystemExit(main())
