#!/usr/bin/env python3
"""Configure verified application identity and resume routes in local SQLite."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = next(path for path in Path(__file__).resolve().parents if (path / "pyproject.toml").exists())
sys.path.insert(0, str(ROOT / "legacy" / "python"))

from resume_builder.job_application.persistence import ApplicationProfileStore  # noqa: E402


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        default=ROOT / "var" / "state" / "job-applications" / "submissions.sqlite3",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    profile = commands.add_parser("profile")
    profile.add_argument("--first-name", required=True)
    profile.add_argument("--last-name", required=True)
    profile.add_argument("--country-name", required=True)
    profile.add_argument("--country-iso", required=True)
    profile.add_argument("--phone-calling-code", required=True)
    profile.add_argument("--verified-phone", default="")

    route = commands.add_parser("resume-route")
    route.add_argument("--filename", required=True)
    route.add_argument("--term", action="append", required=True)
    route.add_argument("--default", action="store_true")

    commands.add_parser("show")
    return parser


def main() -> int:
    args = _parser().parse_args()
    store = ApplicationProfileStore(args.database)
    if args.command == "profile":
        identity = store.save_verified_identity(
            first_name=args.first_name,
            last_name=args.last_name,
            country_name=args.country_name,
            country_iso=args.country_iso,
            phone_calling_code=args.phone_calling_code,
            verified_phone=args.verified_phone,
        )
        print(
            json.dumps(
                {
                    "profile": {
                        "first_name": identity.first_name,
                        "last_name": identity.last_name,
                        "country_name": identity.country_name,
                        "country_iso": identity.country_iso,
                        "phone_calling_code": identity.phone_calling_code,
                        "verified_phone_saved": bool(identity.verified_phone),
                    }
                },
                indent=2,
            )
        )
    elif args.command == "resume-route":
        route = store.replace_resume_route(
            filename=args.filename,
            terms=args.term,
            is_default=args.default,
        )
        print(json.dumps({"resume_route": route.__dict__}, indent=2))
    else:
        identity = store.verified_identity()
        print(
            json.dumps(
                {
                    "profile": (
                        {
                            "first_name": identity.first_name,
                            "last_name": identity.last_name,
                            "country_name": identity.country_name,
                            "country_iso": identity.country_iso,
                            "phone_calling_code": identity.phone_calling_code,
                            "verified_phone_saved": bool(identity.verified_phone),
                        }
                        if identity
                        else None
                    ),
                    "resume_routes": [route.__dict__ for route in store.resume_routes()],
                },
                indent=2,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
