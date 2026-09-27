from __future__ import annotations

import argparse
from pathlib import Path

FORBIDDEN_PARTS = {
    "process_lab",
    "process-lab",
    "schemathesis",
    "prefect",
}
FORBIDDEN_SUFFIXES = {".spec.ts", ".test.ts", ".trace.zip", "-trace.zip"}
FORBIDDEN_CONTENT = (
    b"process_lab",
    b"pytorch-ph-process-lab",
    b"process-lab-tutorial",
    b"prefect",
    b"questionary",
    b"schemathesis",
)
NON_DEPLOYED_ROOTS = {"cache"}


def forbidden_artifacts(root: Path) -> list[str]:
    if not root.exists():
        raise FileNotFoundError(f"Production artifact does not exist: {root}")
    matches: list[str] = []
    for path in root.rglob("*"):
        relative = path.relative_to(root).as_posix().lower()
        if relative.split("/", 1)[0] in NON_DEPLOYED_ROOTS:
            continue
        if any(part in relative for part in FORBIDDEN_PARTS) or any(
            relative.endswith(suffix) for suffix in FORBIDDEN_SUFFIXES
        ):
            matches.append(relative)
            continue
        if path.is_file():
            content = path.read_bytes().lower()
            for marker in FORBIDDEN_CONTENT:
                if marker in content:
                    matches.append(f"{relative}::content:{marker.decode()}")
                    break
    return sorted(matches)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fail if a production artifact contains lab code.")
    parser.add_argument("artifact", type=Path)
    args = parser.parse_args()
    matches = forbidden_artifacts(args.artifact.resolve())
    if matches:
        print("Developer-only files found in production artifact:")
        for match in matches:
            print(f"  {match}")
        return 1
    print(f"Production artifact is process-lab clean: {args.artifact}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
